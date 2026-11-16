import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { StudentFeeHistory } from '../../core/models/models';
import { LABELS } from '../../core/labels';
import { CentreService, logoUrl } from '../../core/services/centre.service';
import { FeeService } from '../../core/services/fee.service';
import { StudentService } from '../../core/services/student.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { longDate, niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

/**
 * /students/:id/admission — "Admission confirmed" right after adding a student (?new=1&sent=1|0),
 * and the printable admission slip at any time (from the student page).
 */
@Component({
  selector: 'app-admission',
  imports: [RouterLink, Icon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admission.html',
  styleUrls: ['../receipts/receipt.scss', './admission.scss'],
})
export class Admission {
  private readonly fees = inject(FeeService);
  private readonly students = inject(StudentService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly centre = inject(CentreService);

  readonly id = input.required<string>();
  /** Query params set by the add-student form. */
  readonly new = input<string>();
  readonly sent = input<string>();

  protected readonly data = signal<StudentFeeHistory | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly resending = signal(false);
  protected readonly resent = signal(false);
  protected readonly rupees = rupees;
  protected readonly longDate = longDate;
  protected readonly niceDate = niceDate;
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly isNew = computed(() => this.new() === '1');
  protected readonly messageSent = computed(() => this.resent() || this.sent() === '1');
  protected readonly group = computed(() => LABELS[this.centre.centre()?.institutionType ?? 'Coaching']?.group ?? 'Batch');
  protected readonly logo = computed(() => (this.logoFailed() ? null : logoUrl(this.centre.centre()?.logoId)));
  /** Fees to pay now: everything unpaid, oldest first. */
  protected readonly dueNow = computed(() =>
    (this.data()?.dues ?? []).filter((d) => d.balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  );
  protected readonly totalDue = computed(() => this.dueNow().reduce((s, d) => s + d.balance, 0));

  /** WhatsApp share link with the slip in text form (opens WhatsApp with the parent's number). */
  protected readonly whatsappUrl = computed(() => {
    const d = this.data();
    const c = this.centre.centre();
    if (!d || !c) return '';
    const st = d.student;
    const lines = this.dueNow().map((x) => `• ${x.headName} (${x.periodLabel}): ${rupees(x.balance)}, due ${niceDate(x.dueDate)}`);
    const text =
      `${c.name}${c.phone ? ` · ${c.phone}` : ''}\nAdmission confirmed ✅\n` +
      `Admission no. ${st.admissionNo ?? '—'} · ${niceDate(st.joinedOn)}\n` +
      `Student: ${st.name} (${d.batchName})\n` +
      (lines.length ? `Fees to pay:\n${lines.join('\n')}\nTotal: ${rupees(this.totalDue())}\n` : '') +
      'Welcome!';
    return `https://wa.me/91${st.parentPhone}?text=${encodeURIComponent(text)}`;
  });

  constructor() {
    if (!this.centre.centre()) this.centre.load().subscribe();
    effect(() => {
      this.fees.history(this.id()).subscribe({
        next: (h) => this.data.set(h),
        error: () => this.router.navigateByUrl('/students'),
      });
    });
  }

  protected print(): void {
    window.print();
  }

  protected resend(): void {
    if (this.resending()) return;
    this.resending.set(true);
    this.students.resendAdmission(this.id()).subscribe({
      next: () => {
        this.resending.set(false);
        this.resent.set(true);
        this.toast.show('Admission confirmation sent on WhatsApp');
      },
      error: (e) => {
        this.resending.set(false);
        this.toast.show(errorMessage(e));
      },
    });
  }
}
