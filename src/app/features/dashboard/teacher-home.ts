import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TeacherDashboard } from '../../core/models/models';
import { TPipe } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import { CentreService } from '../../core/services/centre.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { initials, isoDate } from '../../shared/format';

type ClassState = 'done' | 'next' | 'later' | 'missed';

/** A teacher's home screen: today's classes, who keeps missing class, and how each batch is doing. No money. */
@Component({
  selector: 'app-teacher-home',
  imports: [RouterLink, TPipe],
  templateUrl: './teacher-home.html',
  styleUrl: './teacher-home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeacherHome {
  private readonly dashboard = inject(DashboardService);
  protected readonly auth = inject(AuthService);
  protected readonly centre = inject(CentreService);

  protected readonly data = signal<TeacherDashboard | null>(null);
  protected readonly failed = signal(false);
  protected readonly initials = initials;

  /** Re-evaluated every minute so "in 1 h 47 min" stays right. */
  private readonly now = signal(new Date());

  protected readonly greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();
  protected readonly todayLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  protected readonly firstName = computed(
    () => (this.auth.user()?.name ?? '').trim().split(/\s+/)[0] ?? '',
  );

  /** Today's classes with a state for colouring. */
  protected readonly today = computed(() => {
    const d = this.data();
    if (!d) return [];
    const mins = this.minutesNow();
    const nextId = this.nextClass()?.batchId;
    return d.classesToday.map((c) => {
      const start = c.startTime ? toMinutes(c.startTime) : null;
      const end = c.endTime ? toMinutes(c.endTime) : start !== null ? start + 60 : null;
      const state: ClassState =
        c.present !== null
          ? 'done'
          : c.batchId === nextId
            ? 'next'
            : end !== null && end < mins
              ? 'missed'
              : 'later';
      return {
        ...c,
        time: c.startTime ? clock(c.startTime) : '',
        state,
        note:
          state === 'done'
            ? (c.markedAt ? `Marked at ${clock(c.markedAt)}` : 'Marked') +
              (c.alerted ? ` · ${c.alerted} parent${c.alerted === 1 ? '' : 's'} alerted` : '')
            : state === 'missed'
              ? 'Not marked'
              : 'Not marked yet',
        badge:
          state === 'done'
            ? `${c.present} / ${c.students}`
            : state === 'next'
              ? 'Next'
              : state === 'missed'
                ? 'Mark now'
                : c.startTime
                  ? clock(c.startTime)
                  : '',
      };
    });
  });

  /** The class to show big: the first unmarked class that hasn't ended, else the first unmarked one. */
  protected readonly nextClass = computed(() => {
    const d = this.data();
    if (!d) return null;
    const mins = this.minutesNow();
    const open = d.classesToday.filter((c) => c.present === null);
    const upcoming = open.find((c) => {
      const end = c.endTime
        ? toMinutes(c.endTime)
        : c.startTime
          ? toMinutes(c.startTime) + 60
          : 24 * 60;
      return end >= mins;
    });
    return upcoming ?? open[0] ?? null;
  });

  protected readonly nextLabel = computed(() => {
    const c = this.nextClass();
    if (!c?.startTime) return 'Your next class';
    const diff = toMinutes(c.startTime) - this.minutesNow();
    if (diff > 0) {
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return `Your next class · in ${h ? `${h} h ` : ''}${m} min`;
    }
    const end = c.endTime ? toMinutes(c.endTime) : toMinutes(c.startTime) + 60;
    return end >= this.minutesNow()
      ? 'Happening now · mark the register'
      : 'This class is over · register not marked';
  });

  protected readonly nextTime = computed(() => {
    const c = this.nextClass();
    if (!c) return '';
    const parts = [
      c.startTime && c.endTime
        ? `${clock(c.startTime)} – ${clock(c.endTime)}`
        : c.startTime
          ? clock(c.startTime)
          : '',
    ];
    parts.push(`${c.students} students`);
    if (c.days) parts.push(c.days);
    return parts.filter(Boolean).join(' · ');
  });

  protected readonly allDoneToday = computed(() => {
    const d = this.data();
    return !!d && d.classesToday.length > 0 && d.classesToday.every((c) => c.present !== null);
  });

  protected readonly monthChange = computed(() => {
    const d = this.data();
    if (!d || d.monthPct === null || d.prevMonthPct === null) return null;
    return d.monthPct - d.prevMonthPct;
  });

  protected readonly monthName = new Date().toLocaleString('en-IN', { month: 'long' });
  protected readonly prevMonthName = new Date(
    new Date().getFullYear(),
    new Date().getMonth() - 1,
    1,
  ).toLocaleString('en-IN', { month: 'long' });

  protected readonly weekLeft = computed(() => {
    const d = this.data();
    return d ? Math.max(0, d.weekScheduled - d.weekMarked) : 0;
  });

  protected readonly watch = computed(() =>
    (this.data()?.watch ?? []).map((w) => ({ ...w, last: shortDay(w.lastAbsent) })),
  );

  protected readonly batches = computed(() =>
    (this.data()?.batches ?? []).map((b) => ({
      ...b,
      bars: b.classes.map((c) => ({
        key: c.date,
        height: Math.max(6, Math.min(100, Math.round(((c.pct - 60) / 40) * 100))),
        low: c.pct < 85,
        title: `${shortDay(c.date)} · ${c.pct}%`,
      })),
      note:
        `${b.students} students` +
        (b.lowest
          ? ` · lowest ${b.lowest.pct}% on ${shortDay(b.lowest.date)}`
          : ' · nothing marked in 30 days'),
    })),
  );

  protected readonly week = computed(() => {
    const d = this.data();
    if (!d) return null;
    const todayIso = isoDate();
    const start = new Date(d.week.start + 'T00:00:00');
    const days = [0, 1, 2, 3, 4, 5].map((i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = isoDate(date);
      return {
        iso,
        label: date.toLocaleDateString('en-IN', { weekday: 'short' }) + ' ' + date.getDate(),
        today: iso === todayIso,
      };
    });
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 5);
    const range = `${start.getDate()} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`;
    const rows = d.week.slots.map((s) => ({
      batchId: s.batchId,
      time: s.startTime ? clock(s.startTime) : '',
      cells: s.days.map((c) => {
        const kind: 'none' | 'done' | 'next' | 'missed' | 'later' = !c.scheduled
          ? 'none'
          : c.present !== null
            ? 'done'
            : c.date === todayIso
              ? 'next'
              : c.date < todayIso
                ? 'missed'
                : 'later';
        return {
          key: c.date,
          kind,
          title: kind === 'none' ? 'No class' : s.name,
          sub:
            kind === 'done'
              ? `${c.present} / ${c.students} present`
              : kind === 'next'
                ? s.startTime
                  ? `Mark at ${clock(s.startTime)}`
                  : 'Mark today'
                : kind === 'missed'
                  ? 'Not marked'
                  : kind === 'later'
                    ? `${c.students} students`
                    : '',
        };
      }),
    }));
    return { days, range, rows };
  });

  constructor() {
    this.dashboard.teacher(this.auth.user()?.batchIds ?? []).subscribe({
      next: (d) => this.data.set(d),
      error: () => this.failed.set(true),
    });
    const timer = setInterval(() => this.now.set(new Date()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private minutesNow(): number {
    const n = this.now();
    return n.getHours() * 60 + n.getMinutes();
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "16:00" -> "4:00 PM" */
function clock(hhmm: string): string {
  const mins = toMinutes(hhmm);
  const h = Math.floor(mins / 60);
  return `${h % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-11-07" -> "today", "Thu", or "31 Oct" for older dates. */
function shortDay(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(isoDate() + 'T00:00:00');
  const days = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return d.toLocaleDateString('en-IN', { weekday: 'short' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
