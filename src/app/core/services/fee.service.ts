import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb, MockState } from '../mock/mock-db';
import { FeeDue, FeeDueView, FeeSettings, RecordPaymentRequest } from '../models/models';
import { daysBetween, isoDate, monthKey } from '../../shared/format';
import { ApiService } from './api.service';

export type FeeTab = 'Pending' | 'Paid' | 'All';

export interface FeeSetupRequest {
  settings: FeeSettings;
  batchFees: { batchId: string; monthlyFee: number | null }[];
}

export interface RemindResult {
  sent: number;
}

@Injectable({ providedIn: 'root' })
export class FeeService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  /** GET /fees/settings */
  getSettings(): Observable<FeeSettings | null> {
    if (!environment.useMock) return this.api.get<FeeSettings | null>('fees/settings');
    return this.mock.respond(this.mock.snapshot.feeSettings, 150);
  }

  /** PUT /fees/setup — saves due day, reminder rules and each batch's monthly fee, then creates this month's dues. */
  saveSetup(req: FeeSetupRequest): Observable<FeeSettings> {
    if (!environment.useMock) return this.api.put<FeeSettings>('fees/setup', req);
    this.mock.update((s) => {
      s.feeSettings = req.settings;
      for (const bf of req.batchFees) {
        const b = s.batches.find((x) => x.id === bf.batchId);
        if (b) b.monthlyFee = bf.monthlyFee;
      }
    });
    this.mock.ensureDues();
    return this.mock.respond(req.settings, 400);
  }

  /**
   * GET /fees?month=&status=&search=
   * "Pending" also includes unpaid dues from earlier months, because those are the ones to chase first.
   */
  list(tab: FeeTab, search = '', month = monthKey()): Observable<FeeDueView[]> {
    if (!environment.useMock) return this.api.get<FeeDueView[]>('fees', { month, status: tab, search });
    this.mock.ensureDues(month);
    const s = this.mock.snapshot;
    const q = search.trim().toLowerCase();
    const rows = s.dues
      .filter((d) => {
        if (tab === 'Paid') return d.status === 'Paid' && d.month === month;
        if (tab === 'Pending') return d.status === 'Pending' && d.month <= month;
        return d.month === month || (d.status === 'Pending' && d.month < month);
      })
      .map((d) => toView(d, s))
      .filter((v) => !q || v.studentName.toLowerCase().includes(q) || v.batchName.toLowerCase().includes(q))
      .sort((a, b) => (a.status === b.status ? b.daysLate - a.daysLate : a.status === 'Pending' ? -1 : 1));
    return this.mock.respond(rows, 200);
  }

  /** POST /fees/{id}/remind — queues a WhatsApp reminder (outbox row; Hangfire sends it). */
  remind(dueId: string): Observable<RemindResult> {
    if (!environment.useMock) return this.api.post<RemindResult>(`fees/${dueId}/remind`);
    this.mock.update((s) => {
      const d = s.dues.find((x) => x.id === dueId);
      if (d) d.remindersSent++;
      if (s.centre) s.centre.messagesUsed++;
    });
    return this.mock.respond({ sent: 1 });
  }

  /** POST /fees/remind-all?month= */
  remindAll(month = monthKey()): Observable<RemindResult> {
    if (!environment.useMock) return this.api.post<RemindResult>(`fees/remind-all?month=${month}`);
    let sent = 0;
    this.mock.update((s) => {
      for (const d of s.dues.filter((x) => x.status === 'Pending' && x.month <= month)) {
        d.remindersSent++;
        sent++;
      }
      if (s.centre) s.centre.messagesUsed += sent;
    });
    return this.mock.respond({ sent }, 500);
  }

  /** POST /fees/{id}/payments — cash or UPI received at the centre. Online payments arrive via the Razorpay webhook instead. */
  recordPayment(dueId: string, req: RecordPaymentRequest): Observable<FeeDueView> {
    if (!environment.useMock) return this.api.post<FeeDueView>(`fees/${dueId}/payments`, req);
    let due!: FeeDue;
    this.mock.update((s) => {
      due = s.dues.find((x) => x.id === dueId)!;
      Object.assign(due, { status: 'Paid', paidOn: req.paidOn, paidAmount: req.amount, mode: req.mode });
      if (s.centre) s.centre.messagesUsed++; // receipt on WhatsApp
    });
    return this.mock.respond(toView(due, this.mock.snapshot));
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
