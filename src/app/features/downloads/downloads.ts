import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ExportKind } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { AuthService } from '../../core/services/auth.service';
import { ExportService } from '../../core/services/export.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { isoDate } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

interface Choice {
  kind: ExportKind;
  title: string;
  sub: string;
  /** Uses the date range below. */
  dated: boolean;
}

/**
 * /downloads — Excel files for the accountant or for the centre's own records, and (owner) "Download all my data".
 * Every download is written to the activity log.
 */
@Component({
  selector: 'app-downloads',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="row">
          <a routerLink="/settings" class="icon-btn" aria-label="Back to settings"><app-icon name="chevron-left" /></a>
          <h1 class="page-title">Download to Excel</h1>
        </div>
      </header>

      <section class="card stack" style="gap: 12px">
        <strong>Dates</strong>
        <div class="grid-2">
          <div class="field">
            <label class="label" for="dl-from">From</label>
            <input id="dl-from" class="input" type="date" [max]="to()" [ngModel]="from()" (ngModelChange)="from.set($event)">
          </div>
          <div class="field">
            <label class="label" for="dl-to">To</label>
            <input id="dl-to" class="input" type="date" [min]="from()" [max]="today" [ngModel]="to()" (ngModelChange)="to.set($event)">
          </div>
        </div>
        <div class="chips">
          <button type="button" class="chip" (click)="preset('month')">This month</button>
          <button type="button" class="chip" (click)="preset('last')">Last month</button>
          <button type="button" class="chip" (click)="preset('session')">This session</button>
        </div>
        <span class="muted" style="font-size: 12.5px">Up to 400 days at a time. Students are always the full list.</span>
      </section>

      <div class="card card--list">
        @for (c of choices; track c.kind) {
          <button type="button" class="list-row link-row" [disabled]="busy() !== null" (click)="download(c)">
            <span class="avatar accent"><app-icon [name]="busy() === c.kind ? 'clock' : 'download'" [size]="18" /></span>
            <span class="list-main">
              <span class="list-title">{{ c.title }}</span>
              <span class="list-sub">{{ busy() === c.kind ? 'Preparing…' : c.sub }}</span>
            </span>
          </button>
        }
      </div>

      @if (auth.isOwner()) {
        <section class="card stack" style="gap: 10px">
          <strong>All my data</strong>
          <span class="muted" style="font-size: 13.5px">
            Everything {{ labels.l().orgLower }} has in ClassKendra, as Excel files in one zip: students, fees, receipts and refunds,
            day-book, attendance, staff, setup, WhatsApp messages and the activity log. Yours to keep, whatever you decide later.
          </span>
          <button type="button" class="btn btn-outline" style="align-self: flex-start" [disabled]="busy() !== null" (click)="all()">
            <app-icon name="download" [size]="18" /> {{ busy() === 'all' ? 'Preparing… this can take a minute' : 'Download all my data' }}
          </button>
        </section>
      }
    </div>
  `,
})
export class Downloads {
  private readonly exports = inject(ExportService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  protected readonly labels = inject(LabelService);

  protected readonly today = isoDate();
  protected readonly from = signal(isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  protected readonly to = signal(isoDate());
  protected readonly busy = signal<ExportKind | 'all' | null>(null);

  protected readonly choices: Choice[] = [
    { kind: 'daybook', title: 'Day-book', sub: 'Money in and out each day, by cash / UPI / cheque / online. For your accountant.', dated: true },
    { kind: 'receipts', title: 'Receipts', sub: 'Every receipt in the dates, with what it was for. Cancelled ones are marked.', dated: true },
    { kind: 'fees', title: 'Fees', sub: 'Every fee raised for those months: amount, discount, paid, balance.', dated: true },
    { kind: 'refunds', title: 'Refunds', sub: 'Money given back to parents, with the reason.', dated: true },
    { kind: 'students', title: 'Students', sub: 'Everyone, with parent phone, class, balance due and advance.', dated: false },
  ];

  protected preset(which: 'month' | 'last' | 'session'): void {
    const now = new Date();
    if (which === 'month') {
      this.from.set(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      this.to.set(this.today);
    } else if (which === 'last') {
      this.from.set(isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      this.to.set(isoDate(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else {
      const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // April session
      this.from.set(isoDate(new Date(y, 3, 1)));
      this.to.set(this.today);
    }
  }

  protected download(c: Choice): void {
    this.busy.set(c.kind);
    this.exports.download(c.kind, c.dated ? { from: this.from(), to: this.to() } : {}).subscribe({
      next: () => this.busy.set(null),
      error: (e) => this.failed(e),
    });
  }

  protected all(): void {
    this.busy.set('all');
    this.exports.downloadAll().subscribe({
      next: () => {
        this.busy.set(null);
        this.toast.show('Your data is downloaded');
      },
      error: (e) => this.failed(e),
    });
  }

  /** Errors come back as a Blob (the request asked for a file), so read the message out of it. */
  private failed(e: unknown): void {
    this.busy.set(null);
    const blob = (e as { error?: unknown })?.error;
    if (blob instanceof Blob) {
      blob.text().then((t) => {
        try {
          this.toast.show(JSON.parse(t).message ?? 'Download failed. Please try again.');
        } catch {
          this.toast.show('Download failed. Please try again.');
        }
      });
    } else this.toast.show(errorMessage(e));
  }
}
