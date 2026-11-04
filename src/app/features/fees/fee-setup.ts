import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Batch, FeeSettings } from '../../core/models/models';
import { BatchService } from '../../core/services/batch.service';
import { CentreService } from '../../core/services/centre.service';
import { FeeService } from '../../core/services/fee.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { monthName, monthKey, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

type ReminderKey = 'remindBefore' | 'remindOnDue' | 'remindAfter';

@Component({
  selector: 'app-fee-setup',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fee-setup.html',
  styleUrl: './fees.scss',
})
export class FeeSetup {
  private readonly batchService = inject(BatchService);
  private readonly fees = inject(FeeService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly centre = inject(CentreService);

  protected readonly batches = signal<Batch[]>([]);
  /** batchId -> fee as typed (string so the field can be empty). */
  protected readonly amounts = signal<Record<string, string>>({});
  protected readonly settings = signal<FeeSettings>({ dueDay: 5, remindBefore: true, remindOnDue: true, remindAfter: true });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly dueDays = Array.from({ length: 28 }, (_, i) => i + 1);

  protected readonly reminderRules: { key: ReminderKey; label: string }[] = [
    { key: 'remindBefore', label: '3 days before the due date' },
    { key: 'remindOnDue', label: 'On the due date' },
    { key: 'remindAfter', label: 'Every 3 days until paid' },
  ];

  protected readonly preview = computed(() => {
    const first = this.batches()[0];
    const amount = first ? Number(this.amounts()[first.id] || 0) : 0;
    const name = this.centre.centre()?.name ?? 'your centre';
    const month = monthName(monthKey());
    const day = this.settings().dueDay;
    return `Namaste! Aarav's ${month} fee of ${rupees(amount || 2500)} at ${name} is due on ${day} ${month.slice(0, 3)}. Pay here:`;
  });

  constructor() {
    forkJoin([this.batchService.list(), this.fees.getSettings()]).subscribe(([batches, settings]) => {
      this.batches.set(batches);
      this.amounts.set(Object.fromEntries(batches.map((b) => [b.id, b.monthlyFee ? String(b.monthlyFee) : ''])));
      if (settings) this.settings.set(settings);
    });
  }

  protected setAmount(batchId: string, value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    this.amounts.update((a) => ({ ...a, [batchId]: digits }));
  }

  protected toggle(key: ReminderKey): void {
    this.settings.update((s) => ({ ...s, [key]: !s[key] }));
  }

  protected setDueDay(day: number): void {
    this.settings.update((s) => ({ ...s, dueDay: Number(day) }));
  }

  protected save(): void {
    const batchFees = this.batches().map((b) => ({
      batchId: b.id,
      monthlyFee: this.amounts()[b.id] ? Number(this.amounts()[b.id]) : null,
    }));
    if (!batchFees.some((b) => b.monthlyFee)) {
      this.error.set('Enter a monthly fee for at least one batch.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    this.fees.saveSetup({ settings: this.settings(), batchFees }).subscribe({
      next: () => {
        this.toast.show('Fees saved. Reminders are on.');
        this.router.navigateByUrl('/dashboard');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}
