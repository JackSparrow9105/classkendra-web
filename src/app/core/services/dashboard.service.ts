import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { DashboardSummary } from '../models/models';
import { daysBetween, isoDate, monthKey } from '../../shared/format';
import { ApiService } from './api.service';
import { toView } from './fee.service';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  /** GET /dashboard — in production this reads the precomputed DailySummary row. */
  summary(): Observable<DashboardSummary> {
    if (!environment.useMock) return this.api.get<DashboardSummary>('dashboard');
    const month = monthKey();
    this.mock.ensureDues(month);
    const s = this.mock.snapshot;
    const today = isoDate();
    const monthDues = s.dues.filter((d) => d.month === month);
    const pendingAll = s.dues.filter((d) => d.status === 'Pending' && d.month <= month);
    const dueSoon = pendingAll.filter((d) => {
      const n = daysBetween(today, d.dueDate);
      return n >= 0 && n <= 7;
    });

    const activeIds = new Set(s.students.filter((x) => x.active).map((x) => x.id));
    let marked = 0;
    let absent = 0;
    for (const b of s.batches) {
      const sheet = s.attendance[`${b.id}|${today}`];
      if (!sheet) continue;
      const inBatch = s.students.filter((x) => x.active && x.batchId === b.id).length;
      marked += inBatch;
      absent += sheet.filter((id) => activeIds.has(id)).length;
    }

    const summary: DashboardSummary = {
      month,
      collected: monthDues.filter((d) => d.status === 'Paid').reduce((t, d) => t + (d.paidAmount ?? 0), 0),
      expected: monthDues.reduce((t, d) => t + d.amount, 0),
      pending: pendingAll.reduce((t, d) => t + d.amount, 0),
      pendingCount: new Set(pendingAll.map((d) => d.studentId)).size,
      dueThisWeek: dueSoon.reduce((t, d) => t + d.amount, 0),
      dueThisWeekCount: dueSoon.length,
      presentToday: marked - absent,
      markedToday: marked,
      studentCount: activeIds.size,
      feesConfigured: !!s.feeSettings && s.batches.some((b) => !!b.monthlyFee),
      needsAttention: pendingAll
        .map((d) => toView(d, s))
        .filter((v) => v.daysLate > 0)
        .sort((a, b) => b.daysLate - a.daysLate)
        .slice(0, 4),
    };
    return this.mock.respond(summary, 200);
  }
}
