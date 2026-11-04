import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PaymentView } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { CentreService } from '../../core/services/centre.service';
import { FeeService } from '../../core/services/fee.service';
import { longDate, niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';

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
  protected readonly centre = inject(CentreService);
  protected readonly labels = inject(LabelService);

  readonly id = input.required<string>();
  protected readonly p = signal<PaymentView | null>(null);
  protected readonly rupees = rupees;
  protected readonly longDate = longDate;

  /** WhatsApp share link with the receipt in text form (opens WhatsApp with the parent's number). */
  protected readonly whatsappUrl = computed(() => {
    const r = this.p();
    if (!r) return '';
    const lines = r.allocations.map((a) => `• ${a.headName} (${a.periodLabel}): ${rupees(a.amount)}`).join('\n');
    const text =
      `${this.centre.centre()?.name ?? ''}\nFee receipt ${r.receiptNo} · ${niceDate(r.paidOn)}\n` +
      `Student: ${r.studentName} (${r.batchName})\n${lines}\n` +
      `Total paid: ${rupees(r.amount)} by ${r.mode}\n` +
      (r.balanceAfter > 0 ? `Balance due: ${rupees(r.balanceAfter)}\n` : 'No balance due\n') +
      'Thank you!';
    return `https://wa.me/91${r.parentPhone}?text=${encodeURIComponent(text)}`;
  });

  constructor() {
    if (!this.centre.centre()) this.centre.load().subscribe();
    effect(() => {
      this.fees.getPayment(this.id()).subscribe({
        next: (p) => this.p.set(p),
        error: () => this.router.navigateByUrl('/fees'),
      });
    });
  }

  protected print(): void {
    window.print();
  }
}
