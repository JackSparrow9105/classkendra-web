import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { Concession, PromotionRequest, PromotionResult, Student, StudentImportRow } from '../models/models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/** Concessions are managed through their own endpoints, so they're not part of the student form. */
export type StudentInput = Omit<Student, 'id' | 'active' | 'concessions' | 'admissionNo' | 'admissionMessageSent'> & {
  /** POST only: false = no WhatsApp admission confirmation for this student. */
  sendConfirmation?: boolean;
};

export interface ImportResult {
  added: number;
  skipped: { row: number; reason: string }[];
}

@Injectable({ providedIn: 'root' })
export class StudentService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);
  private readonly auth = inject(AuthService);

  /**
   * GET /students?batchId=&search=
   * The real API should paginate (&page=&pageSize=) for large schools, and limit teachers to their own classes.
   */
  list(filter: { batchId?: string; search?: string } = {}): Observable<Student[]> {
    if (!environment.useMock) return this.api.get<Student[]>('students', filter);
    const q = (filter.search ?? '').trim().toLowerCase();
    const user = this.auth.user();
    const rows = this.mock.snapshot.students
      .filter((s) => s.active)
      .filter((s) => user?.role !== 'Teacher' || user.batchIds.includes(s.batchId))
      .filter((s) => !filter.batchId || s.batchId === filter.batchId)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.parentPhone.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    return this.mock.respond(rows, 150);
  }

  /** GET /students/{id} */
  get(id: string): Observable<Student | undefined> {
    if (!environment.useMock) return this.api.get<Student>(`students/${id}`);
    return this.mock.respond(this.mock.snapshot.students.find((s) => s.id === id));
  }

  /** POST /students */
  create(input: StudentInput): Observable<Student> {
    if (!environment.useMock) return this.api.post<Student>('students', input);
    const dup = this.mock.snapshot.students.find(
      (s) => s.active && s.parentPhone === input.parentPhone && s.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (dup) return this.mock.fail(`${input.name} is already added with this number.`);
    // Demo: admission number per session, like the API ("A-2026-0045").
    const year = new Date(input.joinedOn || Date.now()).getFullYear();
    const used = this.mock.snapshot.students
      .map((x) => x.admissionNo ?? '')
      .filter((no) => no.startsWith(`A-${year}-`))
      .map((no) => Number(no.slice(7)) || 0);
    const admissionNo = `A-${year}-${String(Math.max(40, ...used) + 1).padStart(4, '0')}`;
    const student: Student = { id: this.mock.id('stu'), ...input, active: true, concessions: [], admissionNo };
    this.mock.update((s) => s.students.push(student));
    this.mock.ensureDues();
    const sent = this.mock.snapshot.centre?.sendAdmissionMessages !== false && input.sendConfirmation !== false;
    if (sent) this.logAdmission(student);
    return this.mock.respond({ ...student, admissionMessageSent: sent });
  }

  /** POST /students/{id}/admission-message — send the WhatsApp admission confirmation again. */
  resendAdmission(id: string): Observable<{ sent: boolean }> {
    if (!environment.useMock) return this.api.post<{ sent: boolean }>(`students/${id}/admission-message`, {});
    const st = this.mock.snapshot.students.find((x) => x.id === id);
    if (!st?.admissionNo) return this.mock.fail('This student has no admission number.');
    this.logAdmission(st);
    return this.mock.respond({ sent: true });
  }

  /** Demo only: the admission message, as the API words it. */
  private logAdmission(st: Student): void {
    const s = this.mock.snapshot;
    const batch = s.batches.find((b) => b.id === st.batchId)?.name ?? '';
    const dues = s.dues.filter((d) => d.studentId === st.id && d.status !== 'Paid');
    const amount = dues.reduce((sum, d) => sum + d.amount - d.paidAmount, 0);
    const first = dues.map((d) => d.dueDate).sort()[0];
    const today = new Date().toISOString().slice(0, 10);
    const by = first && first > today ? ` by ${first.slice(8, 10)}/${first.slice(5, 7)}` : '';
    const fees = amount > 0 ? `Fees due${by ? '' : ' now'}: ₹${amount.toLocaleString('en-IN')}${by}.` : 'Welcome aboard!';
    this.mock.update(() => this.mock.logMessage({
      studentId: st.id,
      recipientName: st.parentName || `${st.name}'s parent`,
      phone: st.parentPhone,
      type: 'Admission',
      text: `Welcome to ${s.centre?.name ?? ''}! ${st.name}'s admission in ${batch} is confirmed. Admission no. ${st.admissionNo}. ${fees}`,
    }));
  }

  /** PUT /students/{id} */
  update(id: string, input: StudentInput): Observable<Student> {
    if (!environment.useMock) return this.api.put<Student>(`students/${id}`, input);
    let updated!: Student;
    this.mock.update((s) => {
      s.students = s.students.map((st) => (st.id === id ? (updated = { ...st, ...input }) : st));
      // Opted out of an optional fee (e.g. stopped using transport): cancel its unpaid dues.
      const optionalIds = new Set(s.heads.filter((h) => h.optional).map((h) => h.id));
      s.dues = s.dues.filter(
        (d) => !(d.studentId === id && d.paidAmount === 0 && optionalIds.has(d.feeHeadId) && !input.optionalHeadIds.includes(d.feeHeadId)),
      );
    });
    this.mock.ensureDues();
    return this.mock.respond(updated);
  }

  /** DELETE /students/{id} — soft delete: history and paid fees are kept. */
  deactivate(id: string): Observable<void> {
    if (!environment.useMock) return this.api.delete<void>(`students/${id}`);
    this.mock.update((s) => {
      const st = s.students.find((x) => x.id === id);
      if (st) st.active = false;
      s.dues = s.dues.filter((d) => !(d.studentId === id && d.paidAmount === 0));
    });
    return this.mock.respond(undefined);
  }

  /** POST /students/{id}/concessions — unpaid bills are re-priced straight away. */
  addConcession(studentId: string, c: Omit<Concession, 'id'>): Observable<Student> {
    if (!environment.useMock) return this.api.post<Student>(`students/${studentId}/concessions`, c);
    this.mock.update((s) => s.students.find((x) => x.id === studentId)?.concessions.push({ id: this.mock.id('con'), ...c }));
    this.mock.repriceUnpaid(studentId);
    return this.mock.respond(this.mock.snapshot.students.find((x) => x.id === studentId)!);
  }

  /** DELETE /students/{id}/concessions/{concessionId} */
  removeConcession(studentId: string, concessionId: string): Observable<Student> {
    if (!environment.useMock) return this.api.delete<Student>(`students/${studentId}/concessions/${concessionId}`);
    this.mock.update((s) => {
      const st = s.students.find((x) => x.id === studentId);
      if (st) st.concessions = st.concessions.filter((c) => c.id !== concessionId);
    });
    this.mock.repriceUnpaid(studentId);
    return this.mock.respond(this.mock.snapshot.students.find((x) => x.id === studentId)!);
  }

  /**
   * POST /students/promote  { moves, keepBackStudentIds }
   * Moves whole classes at once (8 · A → 9 · A, 12 → leaving) based on where students are *before*
   * the promotion, so moving 8→9 and 9→10 together works. The API must do this in one transaction.
   * Unpaid fees stay with the student.
   */
  promote(req: PromotionRequest): Observable<PromotionResult> {
    if (!environment.useMock) return this.api.post<PromotionResult>('students/promote', req);
    const result: PromotionResult = { moved: 0, left: 0, keptBack: 0 };
    const target = new Map(req.moves.map((m) => [m.fromBatchId, m.toBatchId]));
    const keep = new Set(req.keepBackStudentIds);
    this.mock.update((s) => {
      for (const st of s.students.filter((x) => x.active && target.has(x.batchId))) {
        if (keep.has(st.id)) {
          result.keptBack++;
          continue;
        }
        const to = target.get(st.batchId);
        if (to === null) {
          st.active = false;
          result.left++;
        } else if (to && to !== st.batchId) {
          st.batchId = to;
          result.moved++;
        }
      }
    });
    return this.mock.respond(result, 700);
  }

  /** POST /students/import — the real API accepts the .xlsx file (multipart) and parses it server-side. */
  import(rows: StudentImportRow[]): Observable<ImportResult> {
    if (!environment.useMock) return this.api.post<ImportResult>('students/import', rows);
    const result: ImportResult = { added: 0, skipped: [] };
    const batches = this.mock.snapshot.batches;
    this.mock.update((s) => {
      rows.forEach((r, i) => {
        // Loose match so "Class 8 · A", "8-A" and "8A" all find the same class.
        const norm = (v: string) => v.toLowerCase().replace(/class/g, '').replace(/[^a-z0-9]/g, '');
        const batch = batches.find((b) => norm(b.name) === norm(r.batchName));
        const phone = r.parentPhone.replace(/\D/g, '').slice(-10);
        if (!r.name.trim()) return result.skipped.push({ row: i + 2, reason: 'Name is empty' });
        if (phone.length !== 10) return result.skipped.push({ row: i + 2, reason: 'Phone number is not 10 digits' });
        if (!batch) return result.skipped.push({ row: i + 2, reason: `"${r.batchName}" doesn't match any batch or class` });
        s.students.push({
          id: this.mock.id('stu'),
          name: r.name.trim(),
          parentName: '',
          parentPhone: phone,
          batchId: batch.id,
          joinedOn: new Date().toISOString().slice(0, 10),
          active: true,
          optionalHeadIds: [],
          concessions: [],
        });
        result.added++;
        return;
      });
    });
    this.mock.ensureDues();
    return this.mock.respond(result, 700);
  }
}
