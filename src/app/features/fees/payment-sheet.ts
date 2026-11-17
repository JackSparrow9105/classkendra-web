import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FamilyMember, FeeDueView, PaymentMode, PaymentView } from '../../core/models/models';
import { FeeService } from '../../core/services/fee.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { isoDate, niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

/**
 * Record money received: tick the fees, enter the amount (less = part payment), pick cash/UPI/cheque.
 * - More than the ticked fees: tick "keep the extra as advance" and it goes on other unpaid fees, then is kept as advance.
 * - Brothers and sisters (same parent phone) with fees due are listed too: tick theirs to take one payment for the
 *   family; each child gets their own receipt, linked together.
 * Used on the Fees screen and the student page.
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
  protected readonly keepExtra = signal(false);
  /** Nothing is due but the parent is paying ahead. */
  protected readonly advanceOnly = signal(false);
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  /** One receipt, or one per child when the family paid together. */
  protected readonly receipts = signal<PaymentView[]>([]);
  /** Brothers and sisters with something due. */
  protected readonly family = signal<FamilyMember[]>([]);
  private changed = false;

  protected readonly today = isoDate();
  protected readonly rupees = rupees;
  protected readonly niceDate = niceDate;

  /** Oldest first: that's the order money is applied in. */
  protected readonly openDues = computed(() =>
    this.dues().filter((d) => d.status !== 'Paid').sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.headName.localeCompare(b.headName)),
  );
  protected readonly paidDues = computed(() => this.dues().filter((d) => d.status === 'Paid'));
  private readonly allOpen = computed(() => [...this.openDues(), ...this.family().flatMap((f) => f.dues)]);
  protected readonly tickedBalance = computed(() =>
    this.allOpen().filter((d) => this.ticked().has(d.id)).reduce((t, d) => t + d.balance, 0),
  );
  /** Brothers' and sisters' fees are ticked: one payment for the family. */
  protected readonly isFamily = computed(() => this.family().some((f) => f.dues.some((d) => this.ticked().has(d.id))));
  /** What will actually be recorded: the typed amount, or the full balance of ticked fees if untouched. */
  protected readonly amount = computed(() => (this.amountEdited() ? Number(this.amountText()) || 0 : this.tickedBalance()));
  protected readonly isPart = computed(() => this.amount() > 0 && this.amount() < this.tickedBalance());
  protected readonly extra = computed(() => Math.max(0, this.amount() - this.tickedBalance()));
  /** Other unpaid fees of this student that the extra will go on before it becomes advance. */
  private readonly untickedOwn = computed(() =>
    this.openDues().filter((d) => !this.ticked().has(d.id)).reduce((t, d) => t + d.balance, 0),
  );
  protected readonly extraText = computed(() => {
    const extra = this.extra();
    const onOthers = Math.min(extra, this.untickedOwn());
    const advance = extra - onOthers;
    if (onOthers > 0 && advance > 0) return `${rupees(onOthers)} goes on ${this.studentName()}'s other fees and ${rupees(advance)} is kept as advance.`;
    if (onOthers > 0) return `${rupees(onOthers)} goes on ${this.studentName()}'s other unpaid fees.`;
    return `${rupees(advance)} is kept as advance and used on the next fees.`;
  });

  ngOnInit(): void {
    this.ticked.set(new Set(this.openDues().map((d) => d.id)));
    this.fees.family(this.studentId()).subscribe({
      next: (members) => this.family.set(members.filter((m) => m.balance > 0)),
      error: () => undefined, // the sheet works without the family list
    });
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

  /** Tick or untick all of one brother's or sister's fees. */
  protected toggleChild(m: FamilyMember): void {
    const all = m.dues.every((d) => this.ticked().has(d.id));
    this.ticked.update((set) => {
      const next = new Set(set);
      for (const d of m.dues) {
        if (all) next.delete(d.id);
        else next.add(d.id);
      }
      return next;
    });
    this.error.set('');
  }

  protected childTicked(m: FamilyMember): boolean {
    return m.dues.length > 0 && m.dues.every((d) => this.ticked().has(d.id));
  }

  protected setAmount(v: string): void {
    const digits = String(v ?? '').replace(/\D/g, '').slice(0, 7);
    this.amountText.set(digits);
    this.amountEdited.set(digits !== '');
    this.error.set('');
  }

  protected startAdvance(): void {
    this.advanceOnly.set(true);
    this.keepExtra.set(true);
    this.ticked.set(new Set());
  }

  protected save(): void {
    const own = this.openDues().filter((d) => this.ticked().has(d.id)).map((d) => d.id);
    const amount = this.amount();
    if (amount <= 0) return this.error.set('Enter the amount received.');

    if (this.isFamily()) {
      if (this.extra() > 0) return this.error.set(`That's more than the ${rupees(this.tickedBalance())} due for the ticked fees.`);
      const items = [
        ...(own.length ? [{ studentId: this.studentId(), dueIds: own }] : []),
        ...this.family()
          .map((f) => ({ studentId: f.studentId, dueIds: f.dues.filter((d) => this.ticked().has(d.id)).map((d) => d.id) }))
          .filter((x) => x.dueIds.length > 0),
      ];
      this.saving.set(true);
      this.fees.recordFamily({ items, amount, mode: this.mode(), paidOn: this.paidOn(), note: this.note().trim() }).subscribe({
        next: (list) => this.done(list),
        error: (e) => this.fail(e),
      });
      return;
    }

    if (!own.length && !this.keepExtra()) return this.error.set('Tick the fees this payment is for.');
    if (this.extra() > 0 && !this.keepExtra()) {
      return this.error.set(`That's more than the ${rupees(this.tickedBalance())} due for the ticked fees. Tick "Keep the extra as advance" to take it.`);
    }
    this.saving.set(true);
    this.fees
      .recordPayment({
        studentId: this.studentId(),
        dueIds: own,
        amount,
        mode: this.mode(),
        paidOn: this.paidOn(),
        note: this.note().trim(),
        keepExtra: this.extra() > 0 || this.advanceOnly(),
      })
      .subscribe({ next: (p) => this.done([p]), error: (e) => this.fail(e) });
  }

  private done(list: PaymentView[]): void {
    this.saving.set(false);
    this.changed = true;
    this.receipts.set(list);
  }

  private fail(e: unknown): void {
    this.saving.set(false);
    this.error.set(errorMessage(e));
  }

  protected totalReceived(): number {
    return this.receipts().reduce((t, r) => t + r.amount, 0);
  }

  /** Part of the payment not on any fee (kept as advance). */
  protected advanceOf(r: PaymentView): number {
    return Math.max(0, r.amount - r.allocations.reduce((t, a) => t + a.amount, 0));
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
