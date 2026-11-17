import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Concession, ConcessionReason, FeeDueView, FeeHead, LeftReason, RefundMode, StudentFeeHistory, Student, StudentAttendance, UpcomingFee } from '../../core/models/models';
import { CONCESSION_REASONS, describeConcession } from '../../core/fees/concessions';
import { FeeService } from '../../core/services/fee.service';
import { StudentService } from '../../core/services/student.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { initials, isoDate, longDate, monthKey, monthName, niceDate, rupees } from '../../shared/format';
import { LabelService } from '../../core/labels';
import { AuthService } from '../../core/services/auth.service';
import { BatchService } from '../../core/services/batch.service';
import { TPipe } from '../../core/i18n/i18n.service';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';
import { PaymentSheet } from '../fees/payment-sheet';

@Component({
  selector: 'app-student-detail',
  imports: [FormsModule, RouterLink, Icon, BottomSheet, PaymentSheet, TPipe],
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
  /** ?pay=1 opens the payment sheet (from the admission screen). */
  readonly pay = input<string>();
  /** ?leave=1 opens the "Mark as left" sheet (from the edit screen). */
  readonly leave = input<string>();
  /** ?tab=fees|attendance|slips opens that tab. */
  readonly tabParam = input<string>(undefined, { alias: 'tab' });

  protected readonly labels = inject(LabelService);
  private readonly auth = inject(AuthService);
  private readonly batchService = inject(BatchService);
  /** Teachers get a read-only profile: details and attendance, no fees. */
  protected readonly isTeacher = this.auth.isTeacher;

  protected readonly tab = signal<'overview' | 'fees' | 'attendance' | 'slips'>('overview');
  protected readonly tabs = computed(() =>
    this.isTeacher()
      ? [{ id: 'overview' as const, label: 'Profile' }, { id: 'attendance' as const, label: 'Attendance' }]
      : [
          { id: 'overview' as const, label: 'Overview' },
          { id: 'fees' as const, label: 'Fees' },
          { id: 'attendance' as const, label: 'Attendance' },
          { id: 'slips' as const, label: 'Slips' },
        ],
  );
  /** Teachers: the student without fee details (GET /students/{id}). */
  private readonly plain = signal<Student | null>(null);
  private readonly batches = signal<{ id: string; name: string }[]>([]);
  protected readonly student = computed(() => this.data()?.student ?? this.plain());
  protected readonly batchName = computed(
    () => this.data()?.batchName ?? this.batches().find((b) => b.id === this.student()?.batchId)?.name ?? '',
  );
  protected readonly upcoming = signal<UpcomingFee[]>([]);
  protected readonly nextDue = computed(() => {
    const open = this.openDues().filter((d) => d.balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (open) return { headName: open.headName, amount: open.balance, dueDate: open.dueDate };
    return this.upcoming()[0] ?? null;
  });
  protected readonly optedInNames = computed(() =>
    (this.student()?.optionalHeadIds ?? []).map((id) => this.heads().find((h) => h.id === id)?.name).filter(Boolean).join(', '),
  );

  // ---------- attendance tab ----------
  protected readonly attendance = signal<StudentAttendance | null>(null);
  protected readonly thisMonth = monthKey();
  private readonly attMonth = signal(monthKey());
  protected readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  protected readonly monthPresent = computed(() => this.attendance()?.days.filter((d) => d.status === 'Present').length ?? 0);
  /** The month as a Monday-first grid: null = blank cell before the 1st. */
  protected readonly calendar = computed(() => {
    const a = this.attendance();
    if (!a) return [];
    const [y, m] = a.month.split('-').map(Number) as [number, number];
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const byDate = new Map(a.days.map((d) => [d.date, d.status]));
    const cells: ({ day: number; status: string | undefined } | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) cells.push({ day: d, status: byDate.get(`${a.month}-${String(d).padStart(2, '0')}`) });
    return cells;
  });

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

  /** "Mark as left" sheet */
  protected readonly leaving = signal(false);
  protected readonly today = isoDate();
  protected readonly leftReasons: { id: LeftReason; label: string }[] = [
    { id: 'Left', label: 'Left' },
    { id: 'Transferred', label: 'Transferred' },
    { id: 'PassedOut', label: 'Passed out' },
    { id: 'Removed', label: 'Removed' },
  ];
  protected readonly leftOn = signal(isoDate());
  protected readonly leftReason = signal<LeftReason>('Left');
  protected readonly leftNote = signal('');
  protected readonly duesChoice = signal<'Keep' | 'Waive'>('Keep');
  protected readonly waiveReason = signal('');
  protected readonly keepReminding = signal(true);
  protected readonly leaveError = signal('');
  private leaveOpened = false;

  /** Money sheets: waive part of a fee, add a charge, refund advance, opening balance. One open at a time. */
  protected readonly sheet = signal<'waive' | 'charge' | 'refund' | 'opening' | null>(null);
  protected readonly waiveDue = signal<FeeDueView | null>(null);
  protected readonly mAmount = signal('');
  protected readonly mReason = signal('');
  protected readonly mName = signal('');
  protected readonly mDate = signal(isoDate());
  protected readonly mMode = signal<RefundMode>('Cash');
  protected readonly mAdvance = signal('');
  protected readonly mError = signal('');
  protected readonly refundModes: RefundMode[] = ['Cash', 'UPI', 'Cheque', 'Bank'];
  protected readonly kindLabel: Record<string, string> = { LateFee: 'Late fee', OpeningBalance: 'Previous dues', Charge: 'Extra charge' };

  protected readonly rupees = rupees;
  protected readonly niceDate = niceDate;
  protected readonly longDate = longDate;
  protected readonly monthName = monthName;
  protected readonly initials = initials;

  protected readonly openDues = computed(() => this.data()?.dues.filter((d) => d.status !== 'Paid') ?? []);

  constructor() {
    effect(() => {
      if (this.pay() === '1' && this.data()) untracked(() => this.paying.set(true));
    });
    effect(() => {
      // Only once: the page reloads its data after every change, and the sheet must not pop up again.
      if (this.leave() === '1' && this.data()?.student.active && !this.leaveOpened) {
        this.leaveOpened = true;
        untracked(() => this.openLeave());
      }
    });
    if (!this.auth.isTeacher()) this.fees.getSetup().subscribe((s) => this.heads.set(s.heads));
    else this.batchService.list().subscribe((b) => this.batches.set(b));
    effect(() => {
      const t = this.tabParam();
      if (t === 'fees' || t === 'attendance' || t === 'slips') untracked(() => this.setTab(t));
    });
    effect(() => this.load(this.id()));
  }

  protected setTab(t: 'overview' | 'fees' | 'attendance' | 'slips'): void {
    if (this.isTeacher() && (t === 'fees' || t === 'slips')) return;
    this.tab.set(t);
  }

  protected shiftMonth(step: number): void {
    const [y, m] = this.attMonth().split('-').map(Number) as [number, number];
    const next = monthKey(new Date(y, m - 1 + step, 1));
    if (next > this.thisMonth) return;
    this.attMonth.set(next);
    this.loadAttendance();
  }

  private loadAttendance(): void {
    this.students.attendance(this.id(), this.attMonth()).subscribe({
      next: (a) => this.attendance.set(a),
      error: () => undefined,
    });
  }

  // ---------- money sheets ----------

  private openSheet(kind: 'waive' | 'charge' | 'refund' | 'opening'): void {
    this.mAmount.set('');
    this.mReason.set('');
    this.mName.set('');
    this.mDate.set(isoDate());
    this.mMode.set('Cash');
    this.mAdvance.set('');
    this.mError.set('');
    this.sheet.set(kind);
  }

  protected openWaive(d: FeeDueView): void {
    this.openSheet('waive');
    this.waiveDue.set(d);
    this.mAmount.set(String(d.balance > 0 ? d.balance : d.amount));
  }

  protected openCharge(): void {
    this.openSheet('charge');
  }

  protected openRefund(): void {
    this.openSheet('refund');
    this.mAmount.set(String(this.data()?.advance ?? ''));
  }

  protected openOpening(): void {
    const o = this.data()?.opening;
    this.openSheet('opening');
    this.mAmount.set(o?.previousDues ? String(o.previousDues) : '');
    this.mAdvance.set(o?.advancePaid ? String(o.advancePaid) : '');
    this.mDate.set(o?.asOn ?? isoDate());
  }

  protected digits(v: string): string {
    return String(v ?? '').replace(/\D/g, '').slice(0, 8);
  }

  /** Waiving more than the unpaid part: the money already paid above the new amount becomes advance. */
  protected waiveNote(): string {
    const d = this.waiveDue();
    const amt = Number(this.mAmount()) || 0;
    if (!d || amt <= 0) return '';
    const newAmount = Math.max(0, d.amount - amt);
    const freed = Math.max(0, d.paidAmount - newAmount);
    if (newAmount === 0 && freed === 0) return 'The whole fee is removed.' + (d.kind === 'LateFee' ? ' This late fee will not be charged again.' : '');
    return freed > 0
      ? `The fee becomes ${rupees(newAmount)}. ${rupees(freed)} already paid becomes advance (used on the next fees, or you can refund it).`
      : `The fee becomes ${rupees(newAmount)}; ${rupees(newAmount - d.paidAmount)} still to pay.`;
  }

  protected saveMoney(): void {
    const kind = this.sheet();
    const id = this.id();
    const amount = Number(this.mAmount()) || 0;
    const reason = this.mReason().trim();
    this.mError.set('');
    const done = (msg: string) => () => {
      this.busy.set(false);
      this.sheet.set(null);
      this.toast.show(msg);
      this.load(id);
    };
    const fail = (e: unknown) => {
      this.busy.set(false);
      this.mError.set(errorMessage(e));
    };

    if (kind === 'waive') {
      const d = this.waiveDue();
      if (!d) return;
      if (amount <= 0) return this.mError.set('Enter how much to waive.');
      if (amount > d.amount) return this.mError.set(`You can waive at most ${rupees(d.amount)} of this fee.`);
      if (reason.length < 10) return this.mError.set('Write why this is being waived (at least 10 letters).');
      this.busy.set(true);
      this.fees.waive(id, d.id, amount, reason).subscribe({ next: done(`${rupees(amount)} waived`), error: fail });
    } else if (kind === 'charge') {
      if (!this.mName().trim()) return this.mError.set('Name the charge, e.g. Lab breakage.');
      if (amount <= 0) return this.mError.set('Enter the amount.');
      this.busy.set(true);
      this.fees
        .addCharge(id, { name: this.mName().trim(), amount, dueDate: this.mDate(), reason })
        .subscribe({ next: done(`Charge of ${rupees(amount)} added`), error: fail });
    } else if (kind === 'refund') {
      if (amount <= 0) return this.mError.set('Enter the amount given back.');
      if (amount > (this.data()?.advance ?? 0)) return this.mError.set(`Only ${rupees(this.data()?.advance ?? 0)} advance can be given back.`);
      if (reason.length < 10) return this.mError.set('Write why the money is given back (at least 10 letters).');
      this.busy.set(true);
      this.fees
        .refund(id, { amount, mode: this.mMode(), refundedOn: this.mDate(), reason })
        .subscribe({ next: (r) => done(`Refund ${r.refundNo} of ${rupees(r.amount)} saved`)(), error: fail });
    } else if (kind === 'opening') {
      this.busy.set(true);
      this.fees
        .setOpening(id, amount, Number(this.mAdvance()) || 0, this.mDate())
        .subscribe({ next: done('Opening balance saved'), error: fail });
    }
  }

  protected leftReasonLabel(r: LeftReason | null | undefined): string {
    return this.leftReasons.find((x) => x.id === r)?.label ?? 'Left';
  }

  protected openLeave(): void {
    this.leftOn.set(this.today);
    this.leftReason.set('Left');
    this.leftNote.set('');
    this.duesChoice.set('Keep');
    this.waiveReason.set('');
    this.keepReminding.set(true);
    this.leaveError.set('');
    this.leaving.set(true);
  }

  /** Marks the student as left. Nothing is deleted; "Rejoin" brings them back. */
  protected saveLeave(): void {
    const d = this.data();
    if (!d) return;
    const waive = d.balance > 0 && this.duesChoice() === 'Waive';
    if (!this.leftOn()) return this.leaveError.set('Choose the last day.');
    if (waive && this.waiveReason().trim().length < 10) return this.leaveError.set('Write why the pending fees are being waived (at least 10 letters).');
    this.busy.set(true);
    this.students
      .leave(this.id(), {
        leftOn: this.leftOn(),
        reason: this.leftReason(),
        note: this.leftNote().trim(),
        dues: waive ? 'Waive' : 'Keep',
        waiveReason: waive ? this.waiveReason().trim() : undefined,
        keepReminding: this.keepReminding(),
      })
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.leaving.set(false);
          const name = res.student.name;
          this.toast.show(
            res.waived > 0 ? `${name} marked as left. ${rupees(res.waived)} waived.`
              : res.stillOwed > 0 ? `${name} marked as left. ${rupees(res.stillOwed)} is still owed.`
              : `${name} marked as left`,
          );
          this.router.navigate(['/students', this.id()], { queryParams: {} });
          this.load(this.id());
        },
        error: (e) => {
          this.busy.set(false);
          this.leaveError.set(errorMessage(e));
        },
      });
  }

  protected rejoin(): void {
    const d = this.data();
    if (!d || !confirm(`Bring ${d.student.name} back to ${d.batchName}? Fees start again from this month.`)) return;
    this.busy.set(true);
    this.students.rejoin(this.id()).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.toast.show(`${s.name} is back in ${d.batchName}`);
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.show(errorMessage(e));
      },
    });
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

  protected copyLink(link: string): void {
    navigator.clipboard?.writeText(link).then(
      () => this.toast.show('Payment link copied'),
      () => this.toast.show(link),
    );
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
    this.loadAttendance();
    if (this.auth.isTeacher()) {
      this.students.get(id).subscribe({
        next: (s) => (s ? this.plain.set(s) : this.router.navigateByUrl('/students')),
        error: () => this.router.navigateByUrl('/students'),
      });
      return;
    }
    this.fees.history(id).subscribe({
      next: (d) => this.data.set(d),
      error: () => this.router.navigateByUrl('/students'),
    });
    this.fees.upcoming(id).subscribe({ next: (u) => this.upcoming.set(u), error: () => this.upcoming.set([]) });
  }
}
