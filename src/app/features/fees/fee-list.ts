import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Batch, FeeSettings, PaymentMode, StudentFees } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { BatchService } from '../../core/services/batch.service';
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
  private readonly batchService = inject(BatchService);
  private readonly toast = inject(ToastService);
  protected readonly labels = inject(LabelService);

  protected readonly tabs: FeeTab[] = ['Pending', 'Paid', 'All'];
  protected readonly tab = signal<FeeTab>('Pending');
  protected readonly month = signal(monthKey());
  protected readonly batchId = signal('');
  protected readonly search = signal('');
  protected readonly rows = signal<StudentFees[]>([]);
  protected readonly batches = signal<Batch[]>([]);
  protected readonly loading = signal(true);
  protected readonly settings = signal<FeeSettings | null | undefined>(undefined);
  protected readonly reminding = signal(false);

  /** Bottom sheet state */
  protected readonly selected = signal<StudentFees | null>(null);
  protected readonly ticked = signal<Set<string>>(new Set());
  protected readonly payMode = signal<PaymentMode>('Cash');
  protected readonly payDate = signal(isoDate());
  protected readonly sheetError = signal('');
  protected readonly saving = signal(false);

  protected readonly rupees = rupees;
  protected readonly initials = initials;
  protected readonly niceDate = niceDate;
  protected readonly monthName = monthName;
  protected readonly today = isoDate();

  protected readonly months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    return monthKey(d);
  });

  protected readonly pendingTotal = computed(() => this.rows().reduce((t, r) => t + r.pending, 0));
  protected readonly pendingCount = computed(() => this.rows().filter((r) => r.pending > 0).length);
  protected readonly paidTotal = computed(() => this.rows().reduce((t, r) => t + r.paid, 0));
  protected readonly tickedTotal = computed(() => {
    const s = this.selected();
    const t = this.ticked();
    return s ? s.dues.filter((d) => t.has(d.id)).reduce((sum, d) => sum + d.amount, 0) : 0;
  });

  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.fees.getSetup().subscribe((s) => this.settings.set(s.settings));
    this.batchService.list().subscribe((b) => this.batches.set(b));
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

  protected setBatch(id: string): void {
    this.batchId.set(id);
    this.load();
  }

  protected onSearch(v: string): void {
    this.search.set(v);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 300);
  }

  protected statusText(r: StudentFees): string {
    if (r.pending === 0) return 'Paid';
    if (r.maxDaysLate > 0) return `${r.maxDaysLate} days late`;
    if (r.nextDueDate === this.today) return 'Due today';
    return r.nextDueDate ? `Due ${niceDate(r.nextDueDate)}` : '';
  }

  protected badgeClass(r: StudentFees): string {
    return r.pending === 0 ? 'ok' : r.maxDaysLate > 0 ? 'warn' : '';
  }

  protected headsSummary(r: StudentFees): string {
    const pending = r.dues.filter((d) => d.status === 'Pending');
    const list = pending.length ? pending : r.dues;
    const names = [...new Set(list.map((d) => d.headName))];
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  }

  protected open(r: StudentFees): void {
    this.selected.set(r);
    this.ticked.set(new Set(r.dues.filter((d) => d.status === 'Pending').map((d) => d.id)));
    this.payMode.set('Cash');
    this.payDate.set(isoDate());
    this.sheetError.set('');
  }

  protected toggleDue(id: string): void {
    this.ticked.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected remind(r: StudentFees): void {
    this.fees.remind([r.studentId]).subscribe(() => {
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
    const ids = [...this.ticked()];
    if (!ids.length) {
      this.sheetError.set('Tick the fees that were paid.');
      return;
    }
    this.saving.set(true);
    this.fees.recordPayment({ dueIds: ids, mode: this.payMode(), paidOn: this.payDate() }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.selected.set(null);
        this.toast.show(`${rupees(res.paid)} recorded. Receipt sent on WhatsApp.`);
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.sheetError.set(errorMessage(e));
      },
    });
  }

  private load(): void {
    this.fees.list(this.tab(), this.search(), this.month(), this.batchId()).subscribe((rows) => {
      this.rows.set(rows);
      this.loading.set(false);
    });
  }
}
