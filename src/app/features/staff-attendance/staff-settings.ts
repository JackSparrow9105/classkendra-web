import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { StaffAttendanceSettings, StaffTiming } from '../../core/models/models';
import { StaffAttendanceService, datesLabel, timeLabel } from '../../core/services/staff-attendance.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

/** /staff-attendance/settings — school timing, check-in location, weekly off, holidays, a different timing for someone. */
@Component({
  selector: 'app-staff-settings',
  imports: [FormsModule, RouterLink, Icon, BottomSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="row">
          <a routerLink="/staff-attendance" class="icon-btn" aria-label="Back to staff attendance"><app-icon name="chevron-left" /></a>
          <h1 class="page-title">Staff attendance settings</h1>
        </div>
      </header>

      @if (s(); as s) {
        <section class="card stack" style="gap: 12px">
          <strong>School timing</strong>
          <div class="row" style="gap: 10px">
            <div class="field" style="flex: 1"><label class="label" for="st-start">Starts</label><input id="st-start" class="input" type="time" [ngModel]="start()" (ngModelChange)="start.set($event)"></div>
            <div class="field" style="flex: 1"><label class="label" for="st-end">Ends</label><input id="st-end" class="input" type="time" [ngModel]="end()" (ngModelChange)="end.set($event)"></div>
          </div>
          <div class="field">
            <span class="label" id="wo-label">Weekly off</span>
            <div class="weekdays" role="group" aria-labelledby="wo-label">
              @for (d of week; track d.n) {
                <button type="button" class="chip" [class.on]="off().includes(d.n)" [attr.aria-pressed]="off().includes(d.n)" [attr.aria-label]="d.full" (click)="toggleOff(d.n)">{{ d.short }}</button>
              }
            </div>
          </div>
          <span class="muted" style="font-size: 12px">Late after {{ s.graceMinutes }} minutes ({{ lateAfter() }}). Holidays and weekly offs never count as absent.</span>
          @if (timingChanged()) {
            <button type="button" class="btn btn-primary block" [disabled]="busy()" (click)="saveTiming()">Save timing</button>
          }
        </section>

        <section class="card stack" style="gap: 10px">
          <div class="row" style="justify-content: space-between">
            <strong>Check-in location</strong>
            @if (s.latitude !== null) { <span class="badge ok">Set</span> } @else { <span class="badge warn">Not set</span> }
          </div>
          <span class="row muted" style="gap: 6px; font-size: 13.5px"><app-icon name="pin" [size]="16" /> Teachers can check in within {{ s.radius }} m of the school.</span>
          @if (s.latitude === null) {
            <span class="muted" style="font-size: 12.5px">Do this once while you're at school. Until then, nobody can check in.</span>
          }
          <button type="button" class="btn btn-outline" style="align-self: flex-start" [disabled]="busy()" (click)="setLocation()">
            {{ locating() ? 'Finding you…' : s.latitude === null ? 'Use where I am now' : 'Update to where I am now' }}
          </button>
        </section>

        <section class="card stack" style="gap: 6px">
          <div class="row" style="justify-content: space-between">
            <strong>Holidays</strong>
            <button type="button" class="btn btn-ghost sm" (click)="addingHoliday.set(true)"><app-icon name="plus" [size]="16" /> Add</button>
          </div>
          @for (h of s.holidays; track h.id) {
            <div class="set-row">
              <span>{{ h.name }}</span>
              <span class="row" style="gap: 6px"><span class="muted">{{ dates(h.from, h.to) }}</span>
                <button type="button" class="icon-btn" [attr.aria-label]="'Delete ' + h.name" (click)="deleteHoliday(h.id, h.name)"><app-icon name="trash" [size]="16" /></button></span>
            </div>
          } @empty {
            <span class="muted" style="font-size: 13px">No holidays added. Add Diwali, Holi, summer break and so on.</span>
          }
        </section>

        <section class="card stack" style="gap: 6px">
          <strong>Different timing</strong>
          <span class="muted" style="font-size: 12.5px">For someone who comes at another time, e.g. office 8:00 am – 3:00 pm.</span>
          @for (p of s.staff; track p.userId) {
            <button type="button" class="set-row row-plain" (click)="openTiming(p)">
              <span>{{ p.name }} <span class="muted">· {{ p.role === 'Teacher' ? 'Teacher' : 'Office' }}</span></span>
              <span class="muted">{{ p.start ? timeLabel(p.start) + ' – ' + timeLabel(p.end) : 'School timing' }}</span>
            </button>
          } @empty {
            <span class="muted" style="font-size: 13px">Add teachers and office staff in Staff first.</span>
          }
        </section>

        <a routerLink="/settings" class="note" style="text-decoration: none">
          <app-icon name="bell" [size]="18" /><span>Leave notifications are in <b>Settings → Staff notifications</b>.</span>
        </a>
      }
    </div>

    @if (addingHoliday()) {
      <app-bottom-sheet title="Add holiday" (closed)="addingHoliday.set(false)">
        <div class="stack" style="gap: 14px">
          <div class="field"><label class="label" for="hd-name">Name</label><input id="hd-name" class="input" maxlength="60" placeholder="e.g. Diwali break" [ngModel]="hName()" (ngModelChange)="hName.set($event)"></div>
          <div class="row" style="gap: 10px">
            <div class="field" style="flex: 1"><label class="label" for="hd-from">From</label><input id="hd-from" class="input" type="date" [ngModel]="hFrom()" (ngModelChange)="setHFrom($event)"></div>
            <div class="field" style="flex: 1"><label class="label" for="hd-to">To</label><input id="hd-to" class="input" type="date" [min]="hFrom()" [ngModel]="hTo()" (ngModelChange)="hTo.set($event)"></div>
          </div>
          <button type="button" class="btn btn-primary lg block" [disabled]="busy()" (click)="addHoliday()">Add holiday</button>
        </div>
      </app-bottom-sheet>
    }

    @if (timingFor(); as p) {
      <app-bottom-sheet [title]="p.name" (closed)="timingFor.set(null)">
        <div class="stack" style="gap: 14px">
          <span class="muted" style="margin-top: -8px">Their own timing. Late is counted from their start time.</span>
          <div class="row" style="gap: 10px">
            <div class="field" style="flex: 1"><label class="label" for="pt-start">Starts</label><input id="pt-start" class="input" type="time" [ngModel]="pStart()" (ngModelChange)="pStart.set($event)"></div>
            <div class="field" style="flex: 1"><label class="label" for="pt-end">Ends</label><input id="pt-end" class="input" type="time" [ngModel]="pEnd()" (ngModelChange)="pEnd.set($event)"></div>
          </div>
          <div class="row" style="gap: 10px">
            @if (p.start) { <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="saveTimingFor(p, true)">Use school timing</button> }
            <button type="button" class="btn btn-primary lg" style="flex: 1" [disabled]="busy()" (click)="saveTimingFor(p, false)">Save</button>
          </div>
        </div>
      </app-bottom-sheet>
    }
  `,
  styles: `
    .row-plain { width: 100%; background: none; border-left: 0; border-right: 0; border-bottom: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; }
  `,
  styleUrl: './staff-attendance.scss',
})
export class StaffSettings {
  private readonly svc = inject(StaffAttendanceService);
  private readonly toast = inject(ToastService);

  protected readonly s = signal<StaffAttendanceSettings | null>(null);
  protected readonly start = signal('07:30');
  protected readonly end = signal('13:30');
  protected readonly off = signal<number[]>([0]);
  protected readonly busy = signal(false);
  protected readonly locating = signal(false);
  protected readonly addingHoliday = signal(false);
  protected readonly hName = signal('');
  protected readonly hFrom = signal('');
  protected readonly hTo = signal('');
  protected readonly timingFor = signal<StaffTiming | null>(null);
  protected readonly pStart = signal('');
  protected readonly pEnd = signal('');
  protected readonly timeLabel = timeLabel;
  protected readonly week = [
    { n: 1, short: 'Mon', full: 'Monday' }, { n: 2, short: 'Tue', full: 'Tuesday' }, { n: 3, short: 'Wed', full: 'Wednesday' },
    { n: 4, short: 'Thu', full: 'Thursday' }, { n: 5, short: 'Fri', full: 'Friday' }, { n: 6, short: 'Sat', full: 'Saturday' },
    { n: 0, short: 'Sun', full: 'Sunday' },
  ];

  protected readonly timingChanged = computed(() => {
    const s = this.s();
    return !!s && (s.start !== this.start() || s.end !== this.end() || [...s.weeklyOff].sort().join() !== [...this.off()].sort().join());
  });
  protected readonly lateAfter = computed(() => {
    const [h, m] = this.start().split(':').map(Number) as [number, number];
    const t = h * 60 + m + (this.s()?.graceMinutes ?? 10);
    return timeLabel(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  });

  constructor() {
    this.svc.settings().subscribe({ next: (s) => this.show(s), error: (e) => this.toast.show(errorMessage(e)) });
  }

  private show(s: StaffAttendanceSettings): void {
    this.s.set(s);
    this.start.set(s.start);
    this.end.set(s.end);
    this.off.set([...s.weeklyOff]);
  }

  protected dates(from: string, to: string): string {
    return datesLabel(from, to);
  }

  protected toggleOff(n: number): void {
    this.off.update((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o, n]));
  }

  private run(call: ReturnType<StaffAttendanceService['settings']>, done: string, after?: () => void): void {
    this.busy.set(true);
    call.subscribe({
      next: (s) => {
        this.busy.set(false);
        this.show(s);
        this.toast.show(done);
        after?.();
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.show(errorMessage(e));
      },
    });
  }

  protected saveTiming(): void {
    this.run(this.svc.saveTiming(this.start(), this.end(), this.off()), 'Timing saved');
  }

  protected setLocation(): void {
    if (!('geolocation' in navigator)) return this.toast.show("This phone can't share its location");
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.locating.set(false);
        if (pos.coords.accuracy > 150) this.toast.show('Location is rough on this phone. Try again near a window or outside.');
        this.run(this.svc.saveLocation(pos.coords.latitude, pos.coords.longitude), 'School location saved');
      },
      (err) => {
        this.locating.set(false);
        this.toast.show(err.code === 1 ? 'Location is blocked. Allow location for ClassKendra in your browser settings.' : "Couldn't find your location. Turn on location (GPS) and try again.");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  protected setHFrom(v: string): void {
    this.hFrom.set(v);
    if (!this.hTo() || this.hTo() < v) this.hTo.set(v);
  }

  protected addHoliday(): void {
    this.run(this.svc.addHoliday(this.hName(), this.hFrom(), this.hTo()), 'Holiday added', () => {
      this.addingHoliday.set(false);
      this.hName.set('');
      this.hFrom.set('');
      this.hTo.set('');
    });
  }

  protected deleteHoliday(id: string, name: string): void {
    if (!confirm(`Delete the holiday “${name}”?`)) return;
    this.run(this.svc.deleteHoliday(id), 'Holiday deleted');
  }

  protected openTiming(p: StaffTiming): void {
    this.timingFor.set(p);
    this.pStart.set(p.start ?? this.start());
    this.pEnd.set(p.end ?? this.end());
  }

  protected saveTimingFor(p: StaffTiming, reset: boolean): void {
    this.run(
      this.svc.savePersonTiming(p.userId, reset ? null : this.pStart(), reset ? null : this.pEnd()),
      reset ? `${p.name} follows the school timing` : `Timing saved for ${p.name}`,
      () => this.timingFor.set(null),
    );
  }
}
