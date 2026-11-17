import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LeaveRequest } from '../../core/models/models';
import { StaffAttendanceService, datesLabel } from '../../core/services/staff-attendance.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { initials } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

/** /staff-attendance/leaves — owner approves or rejects leave requests. */
@Component({
  selector: 'app-staff-leaves',
  imports: [FormsModule, RouterLink, Icon, BottomSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="row">
          <a routerLink="/staff-attendance" class="icon-btn" aria-label="Back to staff attendance"><app-icon name="chevron-left" /></a>
          <h1 class="page-title">Leave requests</h1>
        </div>
      </header>

      @if (pending().length) {
        <p class="section-label">Waiting for you · {{ pending().length }}</p>
        @for (l of pending(); track l.id) {
          <section class="card leave-card">
            <div class="row" style="gap: 12px">
              <span class="avatar">{{ initials(l.name) }}</span>
              <div class="list-main" style="flex: 1; display: flex; flex-direction: column; gap: 2px">
                <span class="list-title" style="font-weight: 700">{{ l.name }}</span>
                <span class="list-sub muted" style="font-size: 12.5px">{{ l.role === 'Teacher' ? 'Teacher' : 'Office' }} · applied {{ ago(l.createdAt) }}</span>
              </div>
            </div>
            <div class="leave-box">
              <b>{{ dates(l) }} · {{ l.days }} working day{{ l.days === 1 ? '' : 's' }}</b>
              <span>“{{ l.reason }}”</span>
              @if (l.takenThisSession !== null) { <span style="font-size: 12px">Leave taken this session: {{ l.takenThisSession }} day{{ l.takenThisSession === 1 ? '' : 's' }}</span> }
            </div>
            <div class="row" style="gap: 8px">
              <button type="button" class="btn btn-outline" style="flex: 1" [disabled]="busy()" (click)="rejecting.set(l)">Reject</button>
              <button type="button" class="btn btn-primary" style="flex: 1" [disabled]="busy()" (click)="decide(l, true)"><app-icon name="check" [size]="18" [stroke]="2.6" /> Approve</button>
            </div>
          </section>
        }
      } @else if (loaded()) {
        <div class="note"><app-icon name="check" [size]="18" /><span>No leave requests waiting.</span></div>
      }

      @if (decided().length) {
        <p class="section-label">Decided</p>
        <section class="card card--list">
          @for (l of decided(); track l.id) {
            <div class="list-row">
              <div class="list-main">
                <span class="list-title" style="font-size: 14px">{{ l.name }} · {{ dates(l) }}</span>
                <span class="list-sub">{{ l.status === 'Rejected' && l.rejectReason ? 'Rejected: ' + l.rejectReason : l.reason }}</span>
              </div>
              <span class="badge" [class.ok]="l.status === 'Approved'" [class.bad]="l.status === 'Rejected'">{{ l.status }}</span>
            </div>
          }
        </section>
      }
    </div>

    @if (rejecting(); as l) {
      <app-bottom-sheet [title]="'Reject ' + l.name + '’s leave?'" (closed)="rejecting.set(null)">
        <div class="stack" style="gap: 14px">
          <span class="muted" style="margin-top: -8px">{{ dates(l) }} · {{ l.days }} day{{ l.days === 1 ? '' : 's' }}</span>
          <div class="field">
            <label class="label" for="rj-reason">Reason <span class="muted" style="font-weight: 400">optional, the teacher sees it</span></label>
            <input id="rj-reason" class="input" maxlength="200" placeholder="e.g. Exams that week" [ngModel]="reason()" (ngModelChange)="reason.set($event)">
          </div>
          <button type="button" class="btn btn-primary lg block" [disabled]="busy()" (click)="decide(l, false)">Reject</button>
        </div>
      </app-bottom-sheet>
    }
  `,
  styleUrl: './staff-attendance.scss',
})
export class StaffLeaves {
  private readonly svc = inject(StaffAttendanceService);
  private readonly toast = inject(ToastService);

  protected readonly list = signal<LeaveRequest[]>([]);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly rejecting = signal<LeaveRequest | null>(null);
  protected readonly reason = signal('');
  protected readonly initials = initials;
  protected readonly pending = computed(() => this.list().filter((l) => l.status === 'Pending'));
  protected readonly decided = computed(() => this.list().filter((l) => l.status !== 'Pending'));

  constructor() {
    this.svc.leaves().subscribe({
      next: (l) => {
        this.list.set(l);
        this.loaded.set(true);
      },
      error: (e) => this.toast.show(errorMessage(e)),
    });
  }

  protected dates(l: LeaveRequest): string {
    return datesLabel(l.from, l.to);
  }

  protected ago(iso: string): string {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    return days <= 0 ? `today ${time}` : days === 1 ? 'yesterday' : `${days} days ago`;
  }

  protected decide(l: LeaveRequest, approve: boolean): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.svc.decide(l.id, approve, approve ? null : this.reason()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.rejecting.set(null);
        this.reason.set('');
        this.list.update((list) => list.map((x) => (x.id === r.id ? r : x)));
        this.toast.show(approve ? `Approved · ${r.name} will be told` : `Rejected · ${r.name} will be told`);
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.show(errorMessage(e));
      },
    });
  }
}
