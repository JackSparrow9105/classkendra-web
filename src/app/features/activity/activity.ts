import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivityAction, ActivityEntry } from '../../core/models/models';
import { ActivityService } from '../../core/services/activity.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { Icon, IconName } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

/**
 * /activity — the activity log (owner only): who cancelled a payment, marked a student as left,
 * waived fees or changed holidays, when, and the reason they gave. Lines can't be edited or removed.
 */
@Component({
  selector: 'app-activity',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="row">
          <a routerLink="/settings" class="icon-btn" aria-label="Back to settings"><app-icon name="chevron-left" /></a>
          <h1 class="page-title">Activity log</h1>
        </div>
      </header>

      <div class="chips" role="group" aria-label="Kind of activity">
        @for (f of filters; track f.id) {
          <button type="button" class="chip dark" [class.on]="action() === f.id" [attr.aria-pressed]="action() === f.id" (click)="setAction(f.id)">{{ f.label }}</button>
        }
      </div>

      <div class="search">
        <app-icon name="search" [size]="18" />
        <label for="act-search" class="sr-only">Search the activity log</label>
        <input id="act-search" type="search" placeholder="Search a name, receipt number or reason" [value]="search()" (input)="onSearch($any($event.target).value)">
      </div>

      @if (loaded() && rows().length === 0) {
        <div class="card stack" style="align-items: center; text-align: center; padding: 28px">
          <strong>Nothing here yet</strong>
          <span class="muted">Cancelled payments, students who leave, waived fees and holiday changes are recorded here with who did it and why.</span>
        </div>
      }

      <div class="stack">
        @for (a of rows(); track a.id) {
          <article class="card stack" style="gap: 6px">
            <div class="row" style="gap: 10px; align-items: flex-start">
              <span class="avatar" [class.warn]="isMoney(a)"><app-icon [name]="icon(a)" [size]="18" /></span>
              <div class="stack" style="gap: 2px; min-width: 0; flex: 1">
                <strong style="font-size: 14.5px">{{ a.summary }}</strong>
                <span class="muted" style="font-size: 12.5px">{{ a.userName }} · {{ role(a) }} · {{ when(a.at) }}</span>
              </div>
            </div>
            @if (a.reason) { <p class="muted" style="font-size: 13.5px; margin: 0">Reason: {{ a.reason }}</p> }
            @if (link(a); as to) { <a [routerLink]="to" style="font-size: 13.5px; font-weight: 600">{{ a.entityType === 'Payment' ? 'Open receipt' : 'Open student' }}</a> }
          </article>
        }
      </div>

      @if (hasMore()) {
        <button type="button" class="btn btn-outline block" [disabled]="loadingMore()" (click)="more()">
          {{ loadingMore() ? 'Loading…' : 'Show more' }} · {{ rows().length }} / {{ total() }}
        </button>
      }
    </div>
  `,
})
export class Activity {
  private readonly svc = inject(ActivityService);
  private readonly toast = inject(ToastService);

  protected readonly filters: { id: ActivityAction | ''; label: string }[] = [
    { id: '', label: 'All' },
    { id: 'PaymentCancelled', label: 'Cancelled payments' },
    { id: 'StudentLeft', label: 'Students left' },
    { id: 'FeesWaived', label: 'Fees waived' },
    { id: 'Refunded', label: 'Refunds' },
    { id: 'ChargeAdded', label: 'Charges' },
    { id: 'BatchChanged', label: 'Batch changes' },
    { id: 'FeeSettingsChanged', label: 'Fee settings' },
    { id: 'StudentRejoined', label: 'Rejoined' },
    { id: 'PromotionUndone', label: 'Promotions undone' },
    { id: 'PaymentRestored', label: 'Payments restored' },
    { id: 'DataExported', label: 'Downloads' },
  ];

  protected readonly action = signal<ActivityAction | ''>('');
  protected readonly search = signal('');
  protected readonly rows = signal<ActivityEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly loaded = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = computed(() => this.rows().length < this.total());

  private page = 1;
  private request = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.load();
  }

  protected setAction(a: ActivityAction | ''): void {
    this.action.set(a);
    this.load();
  }

  protected onSearch(v: string): void {
    this.search.set(v);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 300);
  }

  protected isMoney(a: ActivityEntry): boolean {
    return a.action === 'PaymentCancelled' || a.action === 'FeesWaived' || a.action === 'Refunded';
  }

  protected icon(a: ActivityEntry): IconName {
    switch (a.action) {
      case 'PaymentCancelled': return 'x';
      case 'FeesWaived':
      case 'Refunded':
      case 'ChargeAdded':
      case 'OpeningBalanceSet': return 'wallet';
      case 'StudentLeft': return 'logout';
      case 'StudentRejoined': return 'user-plus';
      case 'DataExported': return 'download';
      case 'PaymentRestored': return 'check';
      case 'HolidayAdded':
      case 'HolidayRemoved': return 'calendar-check';
      default: return 'settings';
    }
  }

  protected role(a: ActivityEntry): string {
    return a.userRole === 'Owner' ? 'Owner' : a.userRole === 'Staff' ? 'Office staff' : a.userRole;
  }

  protected link(a: ActivityEntry): string[] | null {
    if (!a.entityId) return null;
    if (a.entityType === 'Payment') return ['/receipts', a.entityId];
    if (a.entityType === 'Student') return ['/students', a.entityId];
    return null;
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  protected more(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    this.fetch(this.page + 1, this.request);
  }

  private load(): void {
    this.fetch(1, ++this.request);
  }

  private fetch(page: number, request: number): void {
    this.svc.page({ action: this.action(), search: this.search(), page, pageSize: 50 }).subscribe({
      next: (res) => {
        if (request !== this.request) return; // the filters changed while this was loading
        this.page = res.page;
        this.total.set(res.total);
        this.rows.update((rows) => (page === 1 ? res.items : [...rows, ...res.items.filter((r) => !rows.some((x) => x.id === r.id))]));
        this.loaded.set(true);
        this.loadingMore.set(false);
      },
      error: (e) => {
        this.loaded.set(true);
        this.loadingMore.set(false);
        this.toast.show(errorMessage(e));
      },
    });
  }
}
