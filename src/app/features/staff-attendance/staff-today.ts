import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { StaffMarkStatus, StaffToday as StaffTodayData, StaffTodayRow } from '../../core/models/models';
import { StaffAttendanceService, STATUS_LABEL, clockLabel, isoDay, timeLabel } from '../../core/services/staff-attendance.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { initials } from '../../shared/format';
import { BottomSheet } from '../../shared/bottom-sheet';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

/** /staff-attendance — owner: who's in today, late, not in yet, on leave; mark or correct anyone. */
@Component({
  selector: 'app-staff-today',
  imports: [FormsModule, RouterLink, Icon, BottomSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './staff-today.html',
  styleUrl: './staff-attendance.scss',
})
export class StaffToday {
  private readonly svc = inject(StaffAttendanceService);
  private readonly toast = inject(ToastService);

  protected readonly today = isoDay(new Date());
  protected readonly date = signal(this.today);
  protected readonly data = signal<StaffTodayData | null>(null);
  protected readonly locked = signal<'NotSchool' | 'Plan' | null>(null);
  protected readonly pendingLeaves = signal(0);
  protected readonly noLocation = signal(false);
  protected readonly initials = initials;
  protected readonly clockLabel = clockLabel;
  protected readonly timeLabel = timeLabel;
  protected readonly statusLabel = STATUS_LABEL;

  // mark / correct sheet
  protected readonly editing = signal<StaffTodayRow | null>(null);
  protected readonly markStatus = signal<StaffMarkStatus>('Present');
  protected readonly markTime = signal('');
  protected readonly busy = signal(false);

  protected readonly groups = computed(() => {
    const rows = this.data()?.rows ?? [];
    return {
      notYet: rows.filter((r) => r.status === 'NotYet' || r.status === 'Absent'),
      inRows: rows.filter((r) => r.status === 'Present' || r.status === 'Late').sort((a, b) => (a.checkInAt ?? '').localeCompare(b.checkInAt ?? '')),
      leave: rows.filter((r) => r.status === 'Leave'),
      other: rows.filter((r) => r.status === 'WeeklyOff' || r.status === 'Holiday' || r.status === 'None'),
    };
  });
  protected readonly counts = computed(() => {
    const r = this.data()?.rows ?? [];
    return {
      in: r.filter((x) => x.status === 'Present' || x.status === 'Late').length,
      late: r.filter((x) => x.status === 'Late').length,
      notYet: r.filter((x) => x.status === 'NotYet').length,
      absent: r.filter((x) => x.status === 'Absent').length,
      leave: r.filter((x) => x.status === 'Leave').length,
    };
  });
  protected readonly dateTitle = computed(() =>
    this.date() === this.today ? 'Today' : new Date(`${this.date()}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
  );

  constructor() {
    this.svc.status(true).subscribe({
      next: (a) => {
        this.locked.set(a.enabled ? null : a.reason);
        if (!a.enabled) return;
        this.svc.leaves().subscribe({ next: (l) => this.pendingLeaves.set(l.filter((x) => x.status === 'Pending').length), error: () => undefined });
        this.svc.settings().subscribe({ next: (s) => this.noLocation.set(s.latitude == null), error: () => undefined });
      },
      error: () => undefined,
    });
    effect(() => {
      const d = this.date();
      if (this.locked() !== null) return;
      this.svc.today(d).subscribe({ next: (r) => this.data.set(r), error: () => this.data.set(null) });
    });
  }

  protected shift(n: number): void {
    const d = new Date(`${this.date()}T00:00:00`);
    d.setDate(d.getDate() + n);
    const next = isoDay(d);
    if (next <= this.today) this.date.set(next);
  }

  protected rowSub(r: StaffTodayRow): string {
    const role = r.role === 'Teacher' ? 'Teacher' : 'Office';
    const own = r.start !== this.data()?.start || r.end !== this.data()?.end ? ` · timing ${timeLabel(r.start)}` : '';
    if (r.checkInAt) return `In ${clockLabel(r.checkInAt)}${r.checkOutAt ? ` · out ${clockLabel(r.checkOutAt)}` : ''} · ${role}${own}`;
    return `${role}${own}${r.markedByOwner ? ' · marked by you' : ''}`;
  }

  protected open(r: StaffTodayRow): void {
    this.editing.set(r);
    this.markStatus.set(r.status === 'Late' || r.status === 'Absent' || r.status === 'Leave' ? r.status : 'Present');
    this.markTime.set(r.checkInAt ? toHm(r.checkInAt) : '');
  }

  protected save(): void {
    const r = this.editing();
    if (!r || this.busy()) return;
    this.busy.set(true);
    const withTime = this.markStatus() === 'Present' || this.markStatus() === 'Late';
    this.svc.mark(r.userId, this.date(), this.markStatus(), withTime && this.markTime() ? this.markTime() : null).subscribe({
      next: (row) => {
        this.busy.set(false);
        this.data.update((d) => (d ? { ...d, rows: d.rows.map((x) => (x.userId === row.userId ? row : x)) } : d));
        this.editing.set(null);
        this.toast.show(`${row.name}: ${STATUS_LABEL[row.status] || 'cleared'}`);
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.show(errorMessage(e));
      },
    });
  }

  protected clear(): void {
    this.markStatus.set('Clear');
    this.save();
  }
}

function toHm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
