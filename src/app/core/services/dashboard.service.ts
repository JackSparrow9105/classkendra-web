import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { DashboardInsights, DashboardSummary, TeacherDashboard } from '../models/models';
import { daysBetween, isoDate, monthKey } from '../../shared/format';
import { meetsOn } from '../../shared/class-days';
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
    const pendingAll = s.dues.filter((d) => d.status !== 'Paid' && d.month <= month);
    const balance = (d: { amount: number; paidAmount: number }) => d.amount - d.paidAmount;
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
      // Money actually received this month (from receipts), against what was billed this month.
      collected: s.payments
        .filter((p) => p.paidOn.startsWith(month))
        .reduce((t, p) => t + p.amount, 0),
      expected: monthDues.reduce((t, d) => t + d.amount, 0),
      pending: pendingAll.reduce((t, d) => t + balance(d), 0),
      pendingCount: new Set(pendingAll.map((d) => d.studentId)).size,
      dueThisWeek: dueSoon.reduce((t, d) => t + balance(d), 0),
      dueThisWeekCount: new Set(dueSoon.map((d) => d.studentId)).size,
      presentToday: marked - absent,
      markedToday: marked,
      studentCount: activeIds.size,
      feesConfigured:
        !!s.feeSettings && s.heads.some((h) => Object.values(h.amounts).some((a) => a > 0)),
      needsAttention: groupByStudent(pendingAll, s)
        .filter((r) => r.maxDaysLate > 0)
        .sort((a, b) => b.maxDaysLate - a.maxDaysLate)
        .slice(0, 7),
      insights: this.mockInsights(month, today),
    };
    return this.mock.respond(summary, 200);
  }

  /** Same numbers the API's GET /dashboard returns in `insights`, worked out from the in-memory demo data. */
  private mockInsights(month: string, today: string): DashboardInsights {
    const s = this.mock.snapshot;
    const balance = (d: { amount: number; paidAmount: number }) => d.amount - d.paidAmount;
    const active = s.students.filter((x) => x.active);
    const studentById = new Map(s.students.map((x) => [x.id, x]));
    const batchById = new Map(s.batches.map((b) => [b.id, b]));

    const overdueDues = s.dues.filter((d) => d.status !== 'Paid' && d.dueDate < today);
    const monthPayments = s.payments.filter((p) => p.paidOn.startsWith(month));
    const collected = monthPayments.reduce((t, p) => t + p.amount, 0);
    const digital = monthPayments
      .filter((p) => p.mode === 'UPI' || p.mode === 'Online')
      .reduce((t, p) => t + p.amount, 0);

    const monthMessages = s.messages.filter((m) => m.createdAt.slice(0, 7) === month);
    const sent = monthMessages.filter((m) => m.status !== 'Queued');
    const delivered = sent.filter((m) => m.status === 'Delivered' || m.status === 'Read');

    const now = new Date();
    const trend = [5, 4, 3, 2, 1, 0].map((back) => {
      const key = monthKey(new Date(now.getFullYear(), now.getMonth() - back, 1));
      return {
        month: key,
        billed: s.dues.filter((d) => d.month === key).reduce((t, d) => t + d.amount, 0),
        collected: s.payments
          .filter((p) => p.paidOn.startsWith(key))
          .reduce((t, p) => t + p.amount, 0),
      };
    });

    const monthDues = s.dues.filter((d) => d.month === month);
    const batches = s.batches
      .map((b) => {
        const dues = monthDues.filter((d) => d.batchId === b.id);
        return {
          batchId: b.id,
          name: b.name,
          billed: dues.reduce((t, d) => t + d.amount, 0),
          collected: dues.reduce((t, d) => t + d.paidAmount, 0),
        };
      })
      .filter((b) => b.billed > 0);

    const recentPayments = [...s.payments]
      .sort((a, b) =>
        a.paidOn < b.paidOn ? 1 : a.paidOn > b.paidOn ? -1 : b.receiptNo.localeCompare(a.receiptNo),
      )
      .slice(0, 6)
      .map((p) => {
        const st = studentById.get(p.studentId);
        return {
          id: p.id,
          receiptNo: p.receiptNo,
          studentName: st?.name ?? '',
          batchName: (st && batchById.get(st.batchId)?.name) ?? '',
          amount: p.amount,
          mode: p.mode,
          paidOn: p.paidOn,
          at: null,
        };
      });

    const classesToday = s.batches
      .filter((b) => meetsOn(b.days))
      .map((b) => {
        const inBatch = active.filter((x) => x.batchId === b.id);
        const absent = s.attendance[`${b.id}|${today}`];
        const teacher = s.staff.find((m) => m.role === 'Teacher' && m.batchIds.includes(b.id));
        return {
          batchId: b.id,
          name: b.name,
          startTime: b.startTime,
          teacher: teacher?.name ?? null,
          students: inBatch.length,
          present: absent ? inBatch.filter((x) => !absent.includes(x.id)).length : null,
        };
      })
      .sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99'));

    return {
      newThisMonth: active.filter((x) => x.joinedOn.startsWith(month)).length,
      overdue: overdueDues.reduce((t, d) => t + balance(d), 0),
      overdueCount: new Set(overdueDues.map((d) => d.studentId)).size,
      digitalSharePct: collected ? Math.round((digital / collected) * 100) : 0,
      messagesThisMonth: monthMessages.length,
      messagesDeliveredPct: sent.length ? Math.round((delivered.length / sent.length) * 100) : 0,
      messageLimit: s.centre?.messageLimit ?? 0,
      trend,
      batches,
      recentPayments,
      classesToday,
    };
  }

  /**
   * GET /dashboard/teacher — the teacher's home screen (their own batches, attendance only).
   * `batchIds` is only used in demo mode; the API reads the teacher from the login.
   */
  teacher(batchIds: string[] = []): Observable<TeacherDashboard> {
    if (!environment.useMock) return this.api.get<TeacherDashboard>('dashboard/teacher');
    return this.mock.respond(this.mockTeacher(batchIds), 200);
  }

  private mockTeacher(batchIds: string[]): TeacherDashboard {
    const s = this.mock.snapshot;
    const todayDate = new Date();
    const today = isoDate(todayDate);
    const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const batches = s.batches.filter((b) => !batchIds.length || batchIds.includes(b.id));
    const students = s.students.filter((x) => x.active && batches.some((b) => b.id === x.batchId));
    const studentsIn = (batchId: string) => students.filter((x) => x.batchId === batchId);

    // Saved registers: the demo keeps "batchId|date" -> absent student ids.
    const sheets = Object.entries(s.attendance)
      .map(([key, absent]) => {
        const [batchId, date] = key.split('|') as [string, string];
        const total = s.students.filter((x) => x.batchId === batchId && x.active && x.joinedOn <= date).length;
        return { batchId, date, absent, present: Math.max(0, total - absent.length), total };
      })
      .filter((x) => batches.some((b) => b.id === x.batchId) && x.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    const pct = (present: number, total: number) => (total ? Math.round((present / total) * 100) : 100);
    const periodPct = (prefix: string) => {
      const list = sheets.filter((x) => x.date.startsWith(prefix));
      const total = list.reduce((t, x) => t + x.total, 0);
      return total ? pct(list.reduce((t, x) => t + x.present, 0), total) : null;
    };

    const monday = addDays(todayDate, -((todayDate.getDay() + 6) % 7));
    const weekDays = [0, 1, 2, 3, 4, 5].map((i) => addDays(monday, i));
    const weekIso = weekDays.map((d) => isoDate(d));
    const weekSheets = sheets.filter((x) => x.date >= weekIso[0]!);
    const alerts = s.messages.filter((m) => m.type === 'AbsentAlert' && m.createdAt.slice(0, 10) >= weekIso[0]! &&
      students.some((x) => x.id === m.studentId));

    const watch = students
      .map((st) => {
        const recent = sheets.filter((x) => x.batchId === st.batchId && x.date >= st.joinedOn).slice(-12);
        const history = recent.map((x) => x.absent.includes(st.id));
        const lastAbsent = [...recent].reverse().find((x) => x.absent.includes(st.id))?.date ?? '';
        return {
          studentId: st.id,
          name: st.name,
          batchName: batches.find((b) => b.id === st.batchId)?.name ?? '',
          lastAbsent,
          missed: history.filter(Boolean).length,
          of: history.length,
          history,
        };
      })
      .filter((w) => w.missed >= 3)
      .sort((a, b) => b.missed - a.missed || b.lastAbsent.localeCompare(a.lastAbsent))
      .slice(0, 6);

    const trendFrom = isoDate(addDays(todayDate, -30));
    const prev = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);

    return {
      batchCount: batches.length,
      studentCount: students.length,
      monthPct: periodPct(monthKey(todayDate)),
      prevMonthPct: periodPct(monthKey(prev)),
      weekMarked: weekSheets.filter((x) => meetsOn(batches.find((b) => b.id === x.batchId)?.days, new Date(x.date + 'T00:00:00'))).length,
      weekScheduled: batches.reduce((t, b) => t + weekDays.filter((d) => meetsOn(b.days, d)).length, 0),
      alertsThisWeek: alerts.length,
      classesToday: batches
        .filter((b) => meetsOn(b.days, todayDate))
        .sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99'))
        .map((b) => {
          const sheet = sheets.find((x) => x.batchId === b.id && x.date === today);
          const count = studentsIn(b.id).length;
          return {
            batchId: b.id,
            name: b.name,
            startTime: b.startTime,
            endTime: b.endTime,
            days: b.days,
            students: count,
            present: sheet ? Math.max(0, count - sheet.absent.length) : null,
            markedAt: null,
            alerted: sheet ? alerts.filter((m) => m.createdAt.slice(0, 10) === today && sheet.absent.includes(m.studentId ?? '')).length : 0,
          };
        }),
      watch,
      batches: batches.map((b) => {
        const list = sheets.filter((x) => x.batchId === b.id && x.date > trendFrom);
        const classes = list.map((x) => ({ date: x.date, pct: pct(x.present, x.total) }));
        const total = list.reduce((t, x) => t + x.total, 0);
        return {
          batchId: b.id,
          name: b.name,
          students: studentsIn(b.id).length,
          pct: total ? pct(list.reduce((t, x) => t + x.present, 0), total) : null,
          classes,
          lowest: classes.length ? classes.reduce((lo, c) => (c.pct < lo.pct ? c : lo)) : null,
        };
      }),
      week: {
        start: weekIso[0]!,
        slots: batches
          .filter((b) => weekDays.some((d) => meetsOn(b.days, d)))
          .sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.name.localeCompare(b.name))
          .map((b) => ({
            batchId: b.id,
            name: b.name,
            startTime: b.startTime,
            days: weekDays.map((d, i) => {
              const sheet = sheets.find((x) => x.batchId === b.id && x.date === weekIso[i]);
              return {
                date: weekIso[i]!,
                scheduled: meetsOn(b.days, d),
                present: sheet ? sheet.present : null,
                students: sheet ? sheet.total : studentsIn(b.id).length,
              };
            }),
          })),
      },
    };
  }
}
