import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LeaveRequest } from '../../core/models/models';
import { StaffAttendanceService, datesLabel, isoDay } from '../../core/services/staff-attendance.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { Icon } from '../../shared/icon';
import { PushPrompt } from '../../shared/push-prompt';
import { ToastService } from '../../shared/toast';

/** /me/leave — apply for leave and see my requests. */
@Component({
  selector: 'app-my-leave',
  imports: [FormsModule, RouterLink, Icon, PushPrompt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="row">
          <a routerLink="/" class="icon-btn" aria-label="Back"><app-icon name="chevron-left" /></a>
          <h1 class="page-title">My leave</h1>
        </div>
        <a routerLink="/me/attendance" class="btn btn-outline sm">My attendance</a>
      </header>

      <form class="card stack" style="gap: 14px" (ngSubmit)="apply()" novalidate>
        <strong style="font-size: 17px">Apply for leave</strong>
        <div class="row" style="gap: 10px; align-items: flex-start">
          <div class="field" style="flex: 1">
            <label class="label" for="lv-from">From</label>
            <input id="lv-from" class="input" type="date" name="from" [min]="minDate" [ngModel]="from()" (ngModelChange)="setFrom($event)">
          </div>
          <div class="field" style="flex: 1">
            <label class="label" for="lv-to">To</label>
            <input id="lv-to" class="input" type="date" name="to" [min]="from() || minDate" [ngModel]="to()" (ngModelChange)="to.set($event)">
          </div>
        </div>
        <div class="field">
          <label class="label" for="lv-reason">Reason</label>
          <textarea id="lv-reason" class="input" name="reason" rows="3" maxlength="300" style="height: auto; padding-top: 10px; resize: none"
                    placeholder="e.g. Family function, doctor's appointment" [ngModel]="reason()" (ngModelChange)="reason.set($event)"></textarea>
        </div>
        @if (error()) { <div class="note warn" role="alert">{{ error() }}</div> }
        <button type="submit" class="btn btn-primary lg block" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send to principal' }}</button>
        <span class="muted" style="font-size: 12px; margin-top: -6px">The principal approves it in ClassKendra. You'll be told when they decide.</span>
      </form>

      <app-push-prompt />

      @if (list().length) {
        <p class="section-label">My requests</p>
        <section class="card card--list">
          @for (l of list(); track l.id) {
            <div class="list-row">
              <div class="list-main">
                <span class="list-title" style="font-size: 14px">{{ dates(l) }} · {{ l.days }} day{{ l.days === 1 ? '' : 's' }}</span>
                <span class="list-sub">{{ l.status === 'Rejected' && l.rejectReason ? 'Not approved: “' + l.rejectReason + '”' : l.reason }}</span>
              </div>
              @switch (l.status) {
                @case ('Pending') {
                  <span class="badge">Pending</span>
                  <button type="button" class="icon-btn" [attr.aria-label]="'Withdraw request for ' + dates(l)" (click)="withdraw(l)"><app-icon name="x" [size]="16" /></button>
                }
                @case ('Approved') { <span class="badge ok">Approved</span> }
                @default { <span class="badge bad">Not approved</span> }
              }
            </div>
          }
        </section>
      }
    </div>
  `,
  styleUrl: './staff-attendance.scss',
})
export class MyLeave {
  private readonly svc = inject(StaffAttendanceService);
  private readonly toast = inject(ToastService);

  protected readonly list = signal<LeaveRequest[]>([]);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly minDate = isoDay(new Date(Date.now() - 7 * 86400000));
  protected readonly pending = computed(() => this.list().filter((l) => l.status === 'Pending').length);

  constructor() {
    this.load();
  }

  private load(): void {
    this.svc.myLeaves().subscribe({ next: (l) => this.list.set(l), error: () => undefined });
  }

  protected dates(l: LeaveRequest): string {
    return datesLabel(l.from, l.to);
  }

  protected setFrom(v: string): void {
    this.from.set(v);
    if (!this.to() || this.to() < v) this.to.set(v);
  }

  protected apply(): void {
    this.error.set('');
    if (!this.from() || !this.to()) return this.error.set('Choose the dates.');
    if (!this.reason().trim()) return this.error.set('Write a reason.');
    this.busy.set(true);
    this.svc.applyLeave(this.from(), this.to(), this.reason()).subscribe({
      next: (l) => {
        this.busy.set(false);
        this.toast.show(`Sent to principal · ${l.days} working day${l.days === 1 ? '' : 's'}`);
        this.from.set('');
        this.to.set('');
        this.reason.set('');
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected withdraw(l: LeaveRequest): void {
    if (!confirm(`Withdraw your leave request for ${this.dates(l)}?`)) return;
    this.svc.withdrawLeave(l.id).subscribe({
      next: () => {
        this.toast.show('Request withdrawn');
        this.load();
      },
      error: (e) => this.toast.show(errorMessage(e)),
    });
  }
}
