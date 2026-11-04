import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Concession, ConcessionReason, FeeDueView, FeeHead, StudentFeeHistory } from '../../core/models/models';
import { CONCESSION_REASONS, describeConcession } from '../../core/fees/concessions';
import { FeeService } from '../../core/services/fee.service';
import { StudentService } from '../../core/services/student.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { initials, niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';
import { PaymentSheet } from '../fees/payment-sheet';

@Component({
  selector: 'app-student-detail',
  imports: [FormsModule, RouterLink, Icon, BottomSheet, PaymentSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './student-detail.html',
  styleUrl: './student-detail.scss',
})
export class StudentDetail {
  private readonly fees = inject(FeeService);
  private readonly students = inject(StudentService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  /** Route param */
  readonly id = input.required<string>();

  protected readonly data = signal<StudentFeeHistory | null>(null);
  protected readonly heads = signal<FeeHead[]>([]);
  protected readonly paying = signal(false);

  /** Add-discount sheet */
  protected readonly addingDiscount = signal(false);
  protected readonly reasons = CONCESSION_REASONS;
  protected readonly reason = signal<ConcessionReason>('Sibling');
  protected readonly headId = signal<string>('');
  protected readonly kind = signal<Concession['kind']>('Percent');
  protected readonly value = signal('');
  protected readonly note = signal('');
  protected readonly discountError = signal('');
  protected readonly busy = signal(false);

  protected readonly rupees = rupees;
  protected readonly niceDate = niceDate;
  protected readonly initials = initials;

  protected readonly openDues = computed(() => this.data()?.dues.filter((d) => d.status !== 'Paid') ?? []);

  constructor() {
    this.fees.getSetup().subscribe((s) => this.heads.set(s.heads));
    effect(() => this.load(this.id()));
  }

  protected headName(id: string | null): string | null {
    return id ? (this.heads().find((h) => h.id === id)?.name ?? 'a removed fee') : null;
  }

  protected describe(c: Concession): string {
    return describeConcession(c, this.headName(c.feeHeadId));
  }

  protected statusLabel(d: FeeDueView): string {
    if (d.status === 'Paid') return 'Paid';
    if (d.status === 'Partial') return `${rupees(d.balance)} left`;
    if (d.daysLate > 0) return `${d.daysLate} days late`;
    return `Due ${niceDate(d.dueDate)}`;
  }

  protected statusClass(d: FeeDueView): string {
    return d.status === 'Paid' ? 'ok' : d.status === 'Partial' || d.daysLate > 0 ? 'warn' : '';
  }

  protected formatPhone(p: string): string {
    return p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p;
  }

  protected remind(): void {
    const d = this.data();
    if (!d) return;
    this.fees.remind([d.student.id]).subscribe(() => this.toast.show(`Reminder sent to ${d.student.name}'s parent`));
  }

  protected onPaid(changed: boolean): void {
    this.paying.set(false);
    if (changed) this.load(this.id());
  }

  protected openDiscount(): void {
    this.reason.set('Sibling');
    this.headId.set(this.heads().find((h) => !h.optional)?.id ?? '');
    this.kind.set('Percent');
    this.value.set('');
    this.note.set('');
    this.discountError.set('');
    this.addingDiscount.set(true);
  }

  protected setValue(v: string): void {
    this.value.set(String(v ?? '').replace(/\D/g, '').slice(0, 6));
  }

  protected saveDiscount(): void {
    const value = Number(this.value());
    if (!value) return this.discountError.set('Enter the discount.');
    if (this.kind() === 'Percent' && value > 100) return this.discountError.set('A percentage can be at most 100.');
    this.busy.set(true);
    this.students
      .addConcession(this.id(), {
        reason: this.reason(),
        note: this.note().trim(),
        feeHeadId: this.headId() || null,
        kind: this.kind(),
        value,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.addingDiscount.set(false);
          this.toast.show('Discount added. Unpaid fees updated.');
          this.load(this.id());
        },
        error: (e) => {
          this.busy.set(false);
          this.discountError.set(errorMessage(e));
        },
      });
  }

  protected removeDiscount(c: Concession): void {
    if (!confirm(`Remove this discount (${this.describe(c)})? Unpaid fees go back to the full amount.`)) return;
    this.students.removeConcession(this.id(), c.id).subscribe(() => {
      this.toast.show('Discount removed');
      this.load(this.id());
    });
  }

  private load(id: string): void {
    this.fees.history(id).subscribe({
      next: (d) => this.data.set(d),
      error: () => this.router.navigateByUrl('/students'),
    });
  }
}
