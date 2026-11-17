import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StaffMonth } from '../../core/models/models';
import { StaffAttendanceService, clockLabel } from '../../core/services/staff-attendance.service';
import { Icon } from '../../shared/icon';
import { StaffCalendar } from '../../shared/staff-calendar';

/** /me/attendance — a teacher's or office staff member's month. */
@Component({
  selector: 'app-my-attendance',
  imports: [RouterLink, Icon, StaffCalendar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="row">
          <a routerLink="/" class="icon-btn" aria-label="Back"><app-icon name="chevron-left" /></a>
          <h1 class="page-title">My attendance</h1>
        </div>
        <a routerLink="/me/leave" class="btn btn-outline sm">Leave</a>
      </header>

      <div class="month-nav">
        <button type="button" class="icon-btn" aria-label="Previous month" (click)="shift(-1)"><app-icon name="chevron-left" /></button>
        <b>{{ monthTitle() }}</b>
        <button type="button" class="icon-btn" aria-label="Next month" [disabled]="isCurrent()" (click)="shift(1)"><app-icon name="chevron-right" /></button>
      </div>

      @if (data(); as m) {
        <div class="counts">
          <div><b class="ok-t">{{ m.counts.present }}</b><span>On time</span></div>
          <div><b class="warn-t">{{ m.counts.late }}</b><span>Late</span></div>
          <div><b class="acc-t">{{ m.counts.leave }}</b><span>Leave</span></div>
          <div><b class="bad-t">{{ m.counts.absent }}</b><span>Absent</span></div>
        </div>
        <section class="card"><app-staff-calendar [days]="m.days" /></section>

        @if (details().length) {
          <section class="card card--list" aria-label="Details">
            @for (d of details(); track d.date) {
              <div class="list-row">
                <span class="badge" [class]="'badge ' + d.cls">{{ d.label }}</span>
                <div class="list-main">
                  <span class="list-title" style="font-size: 14px">{{ d.when }}</span>
                  <span class="list-sub">{{ d.sub }}</span>
                </div>
              </div>
            }
          </section>
        }
      }
    </div>
  `,
  styleUrl: './staff-attendance.scss',
})
export class MyAttendance {
  private readonly svc = inject(StaffAttendanceService);
  protected readonly month = signal(thisMonth());
  protected readonly data = signal<StaffMonth | null>(null);
  protected readonly isCurrent = computed(() => this.month() >= thisMonth());
  protected readonly monthTitle = computed(() => monthTitle(this.month()));

  /** Late days, leave, absences and holidays, newest first. */
  protected readonly details = computed(() =>
    (this.data()?.days ?? [])
      .filter((d) => ['Late', 'Leave', 'Absent', 'Holiday'].includes(d.status))
      .reverse()
      .map((d) => {
        const when = new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
        switch (d.status) {
          case 'Late':
            return { date: d.date, when, cls: 'warn', label: 'Late', sub: `Checked in ${clockLabel(d.checkInAt)} · ${d.lateMinutes} min late${d.markedByOwner ? ' · marked by principal' : ''}` };
          case 'Leave':
            return { date: d.date, when, cls: 'accent', label: 'Leave', sub: d.markedByOwner ? 'Marked by principal' : 'Approved leave' };
          case 'Absent':
            return { date: d.date, when, cls: 'bad', label: 'Absent', sub: d.markedByOwner ? 'Marked by principal' : 'No check-in' };
          default:
            return { date: d.date, when, cls: 'hol', label: 'Holiday', sub: d.note ?? '' };
        }
      }),
  );

  constructor() {
    effect(() => {
      const m = this.month();
      this.svc.myMonth(m).subscribe({ next: (r) => this.data.set(r), error: () => this.data.set(null) });
    });
  }

  protected shift(n: number): void {
    const [y, m] = this.month().split('-').map(Number) as [number, number];
    const d = new Date(y, m - 1 + n, 1);
    this.month.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
}

export function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
