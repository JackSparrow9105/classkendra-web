import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { DashboardSummary } from '../models/models';
import { daysBetween, isoDate, monthKey } from '../../shared/format';
import { ApiService } from './api.service';
import { groupByStudent } from './fee.service';

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

    const active = s.students.filter((x) => x.active);
    const activeIds = new Set(active.map((x) => x.id));
    let marked = 0;
    let absent = 0;
    for (const b of s.batches) {
      const sheet = s.attendance[`${b.id}|${today}`];
      if (!sheet) continue;
      marked += active.filter((x) => x.batchId === b.id).length;
      absent += sheet.filter((id) => activeIds.has(id)).length;
    }

    const summary: DashboardSummary = {
      month,
      collected: monthDues.filter((d) => d.status === 'Paid').reduce((t, d) => t + (d.paidAmount ?? 0), 0),
      expected: monthDues.reduce((t, d) => t + d.amount, 0),
      pending: pendingAll.reduce((t, d) => t + d.amount, 0),
      pendingCount: new Set(pendingAll.map((d) => d.studentId)).size,
      dueThisWeek: dueSoon.reduce((t, d) => t + d.amount, 0),
      dueThisWeekCount: new Set(dueSoon.map((d) => d.studentId)).size,
      presentToday: marked - absent,
      markedToday: marked,
      studentCount: activeIds.size,
      feesConfigured: !!s.feeSettings && s.heads.some((h) => Object.values(h.amounts).some((a) => a > 0)),
      needsAttention: groupByStudent(pendingAll, s)
        .filter((r) => r.maxDaysLate > 0)
        .sort((a, b) => b.maxDaysLate - a.maxDaysLate)
        .slice(0, 4),
    };
    return this.mock.respond(summary, 200);
  }
}
