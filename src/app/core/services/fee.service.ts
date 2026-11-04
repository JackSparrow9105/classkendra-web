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
  Payment,
  PaymentView,
  RecordPaymentRequest,
  StudentFeeHistory,
  StudentFees,
} from '../models/models';
import { sessionYear } from '../fees/schedule';
import { daysBetween, isoDate, monthKey } from '../../shared/format';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export type FeeTab = 'Pending' | 'Paid' | 'All';

export interface FeeSetup {
  settings: FeeSettings | null;
  heads: FeeHead[];
}

@Injectable({ providedIn: 'root' })
export class FeeService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);
  private readonly auth = inject(AuthService);

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
      s.dues = s.dues.filter((d) => keep.has(d.feeHeadId) || d.paidAmount > 0);
      s.heads = heads;
    });
    this.mock.ensureDues();
    return this.mock.respond({ settings: this.mock.snapshot.feeSettings, heads: this.mock.snapshot.heads }, 400);
  }

  /**
   * GET /fees?month=&status=&search=&batchId=  -> StudentFees[]
   * One row per student. "Pending" (which includes part-paid) also covers unpaid dues from earlier months.
   */
  list(tab: FeeTab, search = '', month = monthKey(), batchId = ''): Observable<StudentFees[]> {
    if (!environment.useMock) return this.api.get<StudentFees[]>('fees', { month, status: tab, search, batchId });
    this.mock.ensureDues(month);
    const s = this.mock.snapshot;
    const q = search.trim().toLowerCase();
    const dues = s.dues.filter((d) => {
      if (batchId && d.batchId !== batchId) return false;
      if (tab === 'Paid') return d.status === 'Paid' && d.month === month;
      if (tab === 'Pending') return d.status !== 'Paid' && d.month <= month;
      return d.month === month || (d.status !== 'Paid' && d.month < month);
    });
    const rows = groupByStudent(dues, s)
      .filter((r) => !q || r.studentName.toLowerCase().includes(q) || r.batchName.toLowerCase().includes(q))
      .sort((a, b) => (b.pending > 0 ? 1 : 0) - (a.pending > 0 ? 1 : 0) || b.maxDaysLate - a.maxDaysLate || a.studentName.localeCompare(b.studentName));
    return this.mock.respond(rows, 200);
  }

  /** GET /students/{id}/fees — every bill and receipt for the current session. */
  history(studentId: string): Observable<StudentFeeHistory> {
    if (!environment.useMock) return this.api.get<StudentFeeHistory>(`students/${studentId}/fees`);
    this.mock.ensureDues();
    const s = this.mock.snapshot;
    const student = s.students.find((x) => x.id === studentId);
    if (!student) return this.mock.fail('Student not found.');
    const start = s.feeSettings?.sessionStartMonth ?? 4;
    const sy = sessionYear(monthKey(), start);
    const inSession = (month: string) => sessionYear(month, start) === sy;
    const dues = s.dues
      .filter((d) => d.studentId === studentId && (inSession(d.month) || d.status !== 'Paid'))
      .map((d) => toView(d, s))
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.headName.localeCompare(b.headName));
    const payments = s.payments
      .filter((p) => p.studentId === studentId)
      .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.receiptNo.localeCompare(a.receiptNo))
      .map((p) => toPaymentView(p, s));
    return this.mock.respond({
      student,
      batchName: s.batches.find((b) => b.id === student.batchId)?.name ?? '',
      dues,
      payments,
      balance: dues.reduce((t, d) => t + d.balance, 0),
      paidThisSession: payments.filter((p) => inSession(p.paidOn.slice(0, 7))).reduce((t, p) => t + p.amount, 0),
    });
  }

  /** POST /fees/remind  { studentIds } — one WhatsApp per family listing everything unpaid (outbox row; Hangfire sends). */
  remind(studentIds: string[]): Observable<{ sent: number }> {
    if (!environment.useMock) return this.api.post<{ sent: number }>('fees/remind', { studentIds });
    let sent = 0;
    this.mock.update((s) => {
      for (const id of studentIds) {
        const pending = s.dues.filter((d) => d.studentId === id && d.status !== 'Paid');
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
    const ids = [...new Set(this.mock.snapshot.dues.filter((d) => d.status !== 'Paid' && d.month <= month).map((d) => d.studentId))];
    return this.remind(ids);
  }

  /**
   * POST /payments  { studentId, dueIds, amount, mode, paidOn, note } -> PaymentView (the receipt)
   * The amount is spread over the chosen dues, oldest first; a smaller amount leaves the rest part-paid.
   * The API assigns the receipt number in the same transaction and queues a WhatsApp receipt.
   * Online payments arrive through the Razorpay webhook and create the same Payment row.
   */
  recordPayment(req: RecordPaymentRequest): Observable<PaymentView> {
    if (!environment.useMock) return this.api.post<PaymentView>('payments', req);
    const s = this.mock.snapshot;
    const dues = s.dues.filter((d) => req.dueIds.includes(d.id) && d.studentId === req.studentId && d.status !== 'Paid');
    const owed = dues.reduce((t, d) => t + d.amount - d.paidAmount, 0);
    if (req.amount <= 0) return this.mock.fail('Enter the amount received.');
    if (req.amount > owed) return this.mock.fail(`That's more than the ₹${owed.toLocaleString('en-IN')} due for the ticked fees.`);
    let payment!: Payment;
    this.mock.update((st) => {
      const allocations = this.mock.allocate(dues, req.amount, req.paidOn);
      payment = {
        id: this.mock.id('pay'),
        receiptNo: this.mock.nextReceiptNo(req.paidOn),
        studentId: req.studentId,
        amount: req.amount,
        mode: req.mode,
        paidOn: req.paidOn,
        note: req.note,
        receivedBy: this.auth.user()?.name || st.centre?.ownerName || 'Office',
        allocations,
      };
      st.payments.push(payment);
      if (st.centre) st.centre.messagesUsed++; // WhatsApp receipt
    });
    return this.mock.respond(toPaymentView(payment, this.mock.snapshot));
  }

  /** GET /payments/{id} — one receipt. */
  getPayment(id: string): Observable<PaymentView> {
    if (!environment.useMock) return this.api.get<PaymentView>(`payments/${id}`);
    const p = this.mock.snapshot.payments.find((x) => x.id === id);
    return p ? this.mock.respond(toPaymentView(p, this.mock.snapshot)) : this.mock.fail('Receipt not found.');
  }
}

export function toView(d: FeeDue, s: MockState): FeeDueView {
  const st = s.students.find((x) => x.id === d.studentId);
  const b = s.batches.find((x) => x.id === d.batchId);
  return {
    ...d,
    studentName: st?.name ?? 'Unknown',
    batchName: b?.name ?? '',
    daysLate: d.status !== 'Paid' ? daysBetween(d.dueDate, isoDate()) : 0,
    balance: d.amount - d.paidAmount,
  };
}

export function toPaymentView(p: Payment, s: MockState): PaymentView {
  const st = s.students.find((x) => x.id === p.studentId);
  const later = s.payments.filter((x) => x.studentId === p.studentId && (x.paidOn > p.paidOn || (x.paidOn === p.paidOn && x.receiptNo > p.receiptNo)));
  const laterPaid = later.reduce((t, x) => t + x.amount, 0);
  const balanceNow = s.dues.filter((d) => d.studentId === p.studentId).reduce((t, d) => t + d.amount - d.paidAmount, 0);
  return {
    ...p,
    studentName: st?.name ?? 'Unknown',
    batchName: s.batches.find((b) => b.id === st?.batchId)?.name ?? '',
    parentPhone: st?.parentPhone ?? '',
    balanceAfter: balanceNow + laterPaid,
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
    row.paid += v.paidAmount;
    if (v.status !== 'Paid') {
      row.pending += v.balance;
      row.maxDaysLate = Math.max(row.maxDaysLate, v.daysLate);
      if (!row.nextDueDate || v.dueDate < row.nextDueDate) row.nextDueDate = v.dueDate;
    }
  }
  for (const r of map.values()) r.dues.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.headName.localeCompare(b.headName));
  return [...map.values()];
}
