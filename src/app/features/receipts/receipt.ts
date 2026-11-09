import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PaymentView, ReceiptSnapshot } from '../../core/models/models';
import { LABELS } from '../../core/labels';
import { CentreService, logoUrl } from '../../core/services/centre.service';
import { FeeService } from '../../core/services/fee.service';
import { longDate, niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';

/**
 * A fee receipt, drawn only from the snapshot frozen at payment time (PaymentView.receipt),
 * so renaming the centre, changing its logo or moving the student never changes an old receipt.
 *
 * `receipt.layout` says which design it was printed with. This page has design 1. When the design
 * changes, keep design 1 in the template (behind `@if (r.layout === 1)`) and add the new one,
 * then raise ReceiptSnapshots.CurrentLayout in the API.
 */
@Component({
  selector: 'app-receipt',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './receipt.html',
  styleUrl: './receipt.scss',
})
export class Receipt {
  private readonly fees = inject(FeeService);
  private readonly router = inject(Router);
  private readonly centre = inject(CentreService);

  readonly id = input.required<string>();
  protected readonly p = signal<PaymentView | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly rupees = rupees;
  protected readonly longDate = longDate;

  /** The frozen receipt. Demo mode has no snapshots, so it is built from today's data there. */
  protected readonly receipt = computed<ReceiptSnapshot | null>(() => {
    const p = this.p();
    return p ? (p.receipt ?? this.fromCurrentData(p)) : null;
  });

  protected readonly group = computed(() => LABELS[this.receipt()?.centre.institutionType ?? 'Coaching']?.group ?? 'Batch');
  protected readonly logo = computed(() => (this.logoFailed() ? null : logoUrl(this.receipt()?.centre.logoId)));

  /** WhatsApp share link with the receipt in text form (opens WhatsApp with the parent's number). */
  protected readonly whatsappUrl = computed(() => {
    const r = this.receipt();
    if (!r) return '';
    const c = r.centre;
    const lines = r.lines.map((a) => `• ${a.headName} (${a.periodLabel}): ${rupees(a.amount)}`).join('\n');
    const text =
      `${c.name}${c.phone ? ` · ${c.phone}` : ''}\nFee receipt ${r.receiptNo} · ${niceDate(r.paidOn)}\n` +
      `Student: ${r.student.name} (${r.student.batchName})\n${lines}\n` +
      `Total paid: ${rupees(r.amount)} by ${r.mode}\n` +
      (r.balanceAfter > 0 ? `Balance due: ${rupees(r.balanceAfter)}\n` : 'No balance due\n') +
      'Thank you!';
    return `https://wa.me/91${r.student.parentPhone}?text=${encodeURIComponent(text)}`;
  });

  constructor() {
    if (!this.centre.centre()) this.centre.load().subscribe();
    effect(() => {
      this.fees.getPayment(this.id()).subscribe({
        next: (p) => {
          this.logoFailed.set(false);
          this.p.set(p);
        },
        error: () => this.router.navigateByUrl('/fees'),
      });
    });
  }

  protected print(): void {
    window.print();
  }

  private fromCurrentData(p: PaymentView): ReceiptSnapshot {
    const c = this.centre.centre();
    return {
      layout: 1,
      rebuilt: true,
      capturedAt: new Date().toISOString(),
      centre: {
        name: c?.name ?? '',
        city: c?.city ?? '',
        address: c?.address ?? '',
        phone: c?.phone ?? '',
        logoId: c?.logoId ?? null,
        institutionType: c?.institutionType ?? 'Coaching',
      },
      student: { name: p.studentName, parentName: '', parentPhone: p.parentPhone, batchName: p.batchName },
      receiptNo: p.receiptNo,
      paidOn: p.paidOn,
      amount: p.amount,
      mode: p.mode,
      note: p.note,
      receivedBy: p.receivedBy,
      lines: p.allocations.map((a) => ({ headName: a.headName, periodLabel: a.periodLabel, amount: a.amount })),
      unallocated: Math.max(0, p.amount - p.allocations.reduce((sum, a) => sum + a.amount, 0)),
      balanceAfter: p.balanceAfter,
    };
  }
}
