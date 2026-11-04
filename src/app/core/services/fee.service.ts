import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb, MockState } from '../mock/mock-db';
import {
  FeeDue,
  FeeDueView,
  FeeHead,
  FeeSettings,
  FeeSetupRequest,
  RecordPaymentRequest,
  StudentFees,
} from '../models/models';
import { daysBetween, isoDate, monthKey } from '../../shared/format';
import { ApiService } from './api.service';

export type FeeTab = 'Pending' | 'Paid' | 'All';

export interface FeeSetup {
  settings: FeeSettings | null;
  heads: FeeHead[];
}

@Injectable({ providedIn: 'root' })
export class FeeService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  /** GET /fees/setup -> { settings, heads } */
  getSetup(): Observable<FeeSetup> {
    if (!environment.useMock) return this.api.get<FeeSetup>('fees/setup');
    const s = this.mock.snapshot;
    return this.mock.respond({ settings: s.feeSettings, heads: s.heads }, 150);
  }

  /**
   * PUT /fees/setup  { settings, heads }
   * New heads come with id "". Heads missing from the list are deleted and their unpaid dues cancelled.
   * Changing an amount affects dues raised from now on; already-raised dues keep their amount.
   */
  saveSetup(req: FeeSetupRequest): Observable<FeeSetup> {
    if (!environment.useMock) return this.api.put<FeeSetup>('fees/setup', req);
    this.mock.update((s) => {
      s.feeSettings = req.settings;
      const heads = req.heads.map((h) => ({ ...h, id: h.id || this.mock.id('head') }));
      const keep = new Set(heads.map((h) => h.id));
      s.dues = s.dues.filter((d) => keep.has(d.feeHeadId) || d.status === 'Paid');
      s.heads = heads;
    });
    this.mock.ensureDues();
    return this.mock.respond({ settings: this.mock.snapshot.feeSettings, heads: this.mock.snapshot.heads }, 400);
  }

  /**
   * GET /fees?month=&status=&search=&batchId=  -> StudentFees[]
   * One row per student. "Pending" includes unpaid dues from earlier months: those are the ones to chase first.
   */
  list(tab: FeeTab, search = '', month = monthKey(), batchId = ''): Observable<StudentFees[]> {
    if (!environment.useMock) return this.api.get<StudentFees[]>('fees', { month, status: tab, search, batchId });
    this.mock.ensureDues(month);
    const s = this.mock.snapshot;
    const q = search.trim().toLowerCase();
    const dues = s.dues.filter((d) => {
      if (batchId && d.batchId !== batchId) return false;
      if (tab === 'Paid') return d.status === 'Paid' && d.month === month;
      if (tab === 'Pending') return d.status === 'Pending' && d.month <= month;
      return d.month === month || (d.status === 'Pending' && d.month < month);
    });
    const rows = groupByStudent(dues, s)
      .filter((r) => !q || r.studentName.toLowerCase().includes(q) || r.batchName.toLowerCase().includes(q))
      .sort((a, b) => (b.pending > 0 ? 1 : 0) - (a.pending > 0 ? 1 : 0) || b.maxDaysLate - a.maxDaysLate || a.studentName.localeCompare(b.studentName));
    return this.mock.respond(rows, 200);
  }

  /** POST /fees/remind  { studentIds } — one WhatsApp per family listing everything unpaid (outbox row; Hangfire sends). */
  remind(studentIds: string[]): Observable<{ sent: number }> {
    if (!environment.useMock) return this.api.post<{ sent: number }>('fees/remind', { studentIds });
    let sent = 0;
    this.mock.update((s) => {
      for (const id of studentIds) {
        const pending = s.dues.filter((d) => d.studentId === id && d.status === 'Pending');
        if (!pending.length) continue;
        pending.forEach((d) => d.remindersSent++);
        sent++;
      }
      if (s.centre) s.centre.messagesUsed += sent;
    });
    return this.mock.respond({ sent }, 300);
  }

  /** POST /fees/remind-all?month= — every family with something unpaid up to that month. */
  remindAll(month = monthKey()): Observable<{ sent: number }> {
    if (!environment.useMock) return this.api.post<{ sent: number }>(`fees/remind-all?month=${month}`);
    const ids = [...new Set(this.mock.snapshot.dues.filter((d) => d.status === 'Pending' && d.month <= month).map((d) => d.studentId))];
    return this.remind(ids);
  }

  /**
   * POST /fees/payments  { dueIds, mode, paidOn }
   * Cash or UPI received at the counter. Each selected due is paid in full; a WhatsApp receipt goes to the parent.
   * Online payments arrive through the Razorpay webhook instead.
   */
  recordPayment(req: RecordPaymentRequest): Observable<{ paid: number }> {
    if (!environment.useMock) return this.api.post<{ paid: number }>('fees/payments', req);
    let paid = 0;
    this.mock.update((s) => {
      for (const d of s.dues.filter((x) => req.dueIds.includes(x.id) && x.status === 'Pending')) {
        Object.assign(d, { status: 'Paid', paidOn: req.paidOn, paidAmount: d.amount, mode: req.mode });
        paid += d.amount;
      }
      if (s.centre) s.centre.messagesUsed++;
    });
    return this.mock.respond({ paid });
  }
}

export function toView(d: FeeDue, s: MockState): FeeDueView {
  const st = s.students.find((x) => x.id === d.studentId);
  const b = s.batches.find((x) => x.id === d.batchId);
  return {
    ...d,
    studentName: st?.name ?? 'Unknown',
    batchName: b?.name ?? '',
    daysLate: d.status === 'Pending' ? daysBetween(d.dueDate, isoDate()) : 0,
  };
}

export function groupByStudent(dues: FeeDue[], s: MockState): StudentFees[] {
  const map = new Map<string, StudentFees>();
  for (const d of dues) {
    const v = toView(d, s);
    let row = map.get(d.studentId);
    if (!row) {
      row = {
        studentId: d.studentId,
        studentName: v.studentName,
        batchId: d.batchId,
        batchName: v.batchName,
        dues: [],
        pending: 0,
        paid: 0,
        maxDaysLate: 0,
        nextDueDate: null,
      };
      map.set(d.studentId, row);
    }
    row.dues.push(v);
    if (v.status === 'Pending') {
      row.pending += v.amount;
      row.maxDaysLate = Math.max(row.maxDaysLate, v.daysLate);
      if (!row.nextDueDate || v.dueDate < row.nextDueDate) row.nextDueDate = v.dueDate;
    } else {
      row.paid += v.paidAmount ?? v.amount;
    }
  }
  for (const r of map.values()) r.dues.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.headName.localeCompare(b.headName));
  return [...map.values()];
}
