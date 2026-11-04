import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FeeDueView, PaymentMode, PaymentView } from '../../core/models/models';
import { FeeService } from '../../core/services/fee.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { isoDate, niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

/**
 * Record money received for one student: tick the fees, enter the amount (less = part payment),
 * pick cash/UPI/cheque. Shows the receipt number when done. Used on the Fees screen and the student page.
 */
@Component({
  selector: 'app-payment-sheet',
  imports: [FormsModule, RouterLink, Icon, BottomSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payment-sheet.html',
  styleUrl: './payment-sheet.scss',
})
export class PaymentSheet implements OnInit {
  private readonly fees = inject(FeeService);
  private readonly toast = inject(ToastService);

  readonly studentId = input.required<string>();
  readonly studentName = input.required<string>();
  readonly batchName = input('');
  readonly dues = input.required<FeeDueView[]>();
  /** Emits true when something changed (payment or reminder) so the parent reloads. */
  readonly closed = output<boolean>();

  protected readonly modes: PaymentMode[] = ['Cash', 'UPI', 'Cheque'];
  protected readonly ticked = signal<Set<string>>(new Set());
  protected readonly amountText = signal('');
  protected readonly amountEdited = signal(false);
  protected readonly mode = signal<PaymentMode>('Cash');
  protected readonly paidOn = signal(isoDate());
  protected readonly note = signal('');
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  protected readonly receipt = signal<PaymentView | null>(null);
  private changed = false;

  protected readonly today = isoDate();
  protected readonly rupees = rupees;
  protected readonly niceDate = niceDate;

  /** Oldest first: that's the order money is applied in. */
  protected readonly openDues = computed(() =>
    this.dues().filter((d) => d.status !== 'Paid').sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.headName.localeCompare(b.headName)),
  );
  protected readonly paidDues = computed(() => this.dues().filter((d) => d.status === 'Paid'));
  protected readonly tickedBalance = computed(() =>
    this.openDues().filter((d) => this.ticked().has(d.id)).reduce((t, d) => t + d.balance, 0),
  );
  /** What will actually be recorded: the typed amount, or the full balance of ticked fees if untouched. */
  protected readonly amount = computed(() => (this.amountEdited() ? Number(this.amountText()) || 0 : this.tickedBalance()));
  protected readonly isPart = computed(() => this.amount() > 0 && this.amount() < this.tickedBalance());

  ngOnInit(): void {
    this.ticked.set(new Set(this.openDues().map((d) => d.id)));
  }

  protected toggle(id: string): void {
    this.ticked.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    this.error.set('');
  }

  protected setAmount(v: string): void {
    const digits = String(v ?? '').replace(/\D/g, '').slice(0, 7);
    this.amountText.set(digits);
    this.amountEdited.set(digits !== '');
    this.error.set('');
  }

  protected save(): void {
    const ids = this.openDues().filter((d) => this.ticked().has(d.id)).map((d) => d.id);
    if (!ids.length) return this.error.set('Tick the fees this payment is for.');
    if (this.amount() <= 0) return this.error.set('Enter the amount received.');
    if (this.amount() > this.tickedBalance()) {
      return this.error.set(`That's more than the ${rupees(this.tickedBalance())} due for the ticked fees.`);
    }
    this.saving.set(true);
    this.fees
      .recordPayment({
        studentId: this.studentId(),
        dueIds: ids,
        amount: this.amount(),
        mode: this.mode(),
        paidOn: this.paidOn(),
        note: this.note().trim(),
      })
      .subscribe({
        next: (p) => {
          this.saving.set(false);
          this.changed = true;
          this.receipt.set(p);
        },
        error: (e) => {
          this.saving.set(false);
          this.error.set(errorMessage(e));
        },
      });
  }

  protected remind(): void {
    this.fees.remind([this.studentId()]).subscribe(() => {
      this.toast.show(`Reminder sent to ${this.studentName()}'s parent`);
      this.closed.emit(true);
    });
  }

  protected close(): void {
    this.closed.emit(this.changed);
  }
}
