import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FeeDueView, FeeSettings, PaymentMode } from '../../core/models/models';
import { FeeService, FeeTab } from '../../core/services/fee.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { initials, isoDate, monthKey, monthName, niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

@Component({
  selector: 'app-fee-list',
  imports: [FormsModule, RouterLink, Icon, BottomSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fee-list.html',
  styleUrl: './fees.scss',
})
export class FeeList {
  private readonly fees = inject(FeeService);
  private readonly toast = inject(ToastService);

  protected readonly tabs: FeeTab[] = ['Pending', 'Paid', 'All'];
  protected readonly tab = signal<FeeTab>('Pending');
  protected readonly month = signal(monthKey());
  protected readonly search = signal('');
  protected readonly rows = signal<FeeDueView[]>([]);
  protected readonly loading = signal(true);
  protected readonly settings = signal<FeeSettings | null | undefined>(undefined);
  protected readonly reminding = signal(false);

  /** Bottom sheet state */
  protected readonly selected = signal<FeeDueView | null>(null);
  protected readonly payAmount = signal('');
  protected readonly payMode = signal<PaymentMode>('Cash');
  protected readonly payDate = signal(isoDate());
  protected readonly sheetError = signal('');
  protected readonly saving = signal(false);

  protected readonly rupees = rupees;
  protected readonly initials = initials;
  protected readonly niceDate = niceDate;
  protected readonly monthName = monthName;

  protected readonly months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    return monthKey(d);
  });

  protected readonly pendingTotal = computed(() =>
    this.rows().filter((r) => r.status === 'Pending').reduce((t, r) => t + r.amount, 0),
  );
  /** Students (not bills) with something pending; one student can owe for two months. */
  protected readonly pendingCount = computed(
    () => new Set(this.rows().filter((r) => r.status === 'Pending').map((r) => r.studentId)).size,
  );
  protected readonly paidTotal = computed(() =>
    this.rows().filter((r) => r.status === 'Paid').reduce((t, r) => t + (r.paidAmount ?? 0), 0),
  );

  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.fees.getSettings().subscribe((s) => this.settings.set(s));
    this.load();
  }

  protected setTab(t: FeeTab): void {
    this.tab.set(t);
    this.load();
  }

  protected setMonth(m: string): void {
    this.month.set(m);
    this.load();
  }

  protected onSearch(v: string): void {
    this.search.set(v);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 300);
  }

  protected statusText(r: FeeDueView): string {
    if (r.status === 'Paid') return `Paid ${niceDate(r.paidOn!)} · ${r.mode}`;
    if (r.daysLate > 0) return `${r.daysLate} days late`;
    if (r.daysLate === 0) return 'Due today';
    return `Due ${niceDate(r.dueDate)}`;
  }

  protected badgeClass(r: FeeDueView): string {
    return r.status === 'Paid' ? 'ok' : r.daysLate > 0 ? 'warn' : '';
  }

  protected open(r: FeeDueView): void {
    this.selected.set(r);
    this.payAmount.set(String(r.amount));
    this.payMode.set('Cash');
    this.payDate.set(isoDate());
    this.sheetError.set('');
  }

  protected setPayAmount(value: string): void {
    this.payAmount.set(String(value ?? '').replace(/\D/g, '').slice(0, 7));
  }

  protected remind(r: FeeDueView): void {
    this.fees.remind(r.id).subscribe(() => {
      this.toast.show(`Reminder sent to ${r.studentName}'s parent`);
      this.selected.set(null);
      this.load();
    });
  }

  protected remindAll(): void {
    this.reminding.set(true);
    this.fees.remindAll(this.month()).subscribe((res) => {
      this.reminding.set(false);
      this.toast.show(`${res.sent} reminders queued on WhatsApp`);
      this.load();
    });
  }

  protected recordPayment(): void {
    const r = this.selected();
    const amount = Number(this.payAmount());
    if (!r) return;
    if (!amount || amount <= 0) {
      this.sheetError.set('Enter the amount received.');
      return;
    }
    this.saving.set(true);
    this.fees.recordPayment(r.id, { amount, mode: this.payMode(), paidOn: this.payDate() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.selected.set(null);
        this.toast.show(`${rupees(amount)} recorded. Receipt sent on WhatsApp.`);
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.sheetError.set(errorMessage(e));
      },
    });
  }

  private load(): void {
    this.fees.list(this.tab(), this.search(), this.month()).subscribe((rows) => {
      this.rows.set(rows);
      this.loading.set(false);
    });
  }
}
