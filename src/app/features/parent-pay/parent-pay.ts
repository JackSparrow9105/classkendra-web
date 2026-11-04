import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { I18nService, TPipe } from '../../core/i18n/i18n.service';
import { Lang, ParentPayPage, PaymentView } from '../../core/models/models';
import { PublicPayService } from '../../core/services/public-pay.service';
import { niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';

/** Public page a parent opens from the WhatsApp reminder. No login, no app. */
@Component({
  selector: 'app-parent-pay',
  imports: [Icon, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './parent-pay.html',
  styleUrl: './parent-pay.scss',
})
export class ParentPay {
  private readonly pay = inject(PublicPayService);
  protected readonly i18n = inject(I18nService);

  readonly token = input.required<string>();

  protected readonly page = signal<ParentPayPage | null>(null);
  protected readonly invalid = signal(false);
  protected readonly ticked = signal<Set<string>>(new Set());
  protected readonly paying = signal(false);
  protected readonly receipt = signal<PaymentView | null>(null);
  protected readonly rupees = rupees;
  protected readonly niceDate = niceDate;

  protected readonly selectedTotal = computed(() =>
    (this.page()?.dues ?? []).filter((d) => this.ticked().has(d.id)).reduce((t, d) => t + d.balance, 0),
  );

  constructor() {
    effect(() => {
      this.pay.page(this.token()).subscribe({
        next: (p) => {
          this.page.set(p);
          this.ticked.set(new Set(p.dues.map((d) => d.id)));
          // First visit on this phone: use the school's message language.
          if (!this.i18n.hasPreference()) this.i18n.set(p.language, false);
        },
        error: () => this.invalid.set(true),
      });
    });
  }

  protected setLang(l: Lang): void {
    this.i18n.set(l);
  }

  protected toggle(id: string): void {
    this.ticked.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected payNow(): void {
    const ids = [...this.ticked()];
    if (!ids.length) return;
    this.paying.set(true);
    this.pay.createOrder(this.token(), ids).subscribe({
      next: (order) => {
        if (environment.useMock) {
          this.pay.confirmDemo(this.token(), ids).subscribe((r) => {
            this.paying.set(false);
            this.receipt.set(r);
          });
          return;
        }
        // Production: open Razorpay Checkout with order.orderId and order.keyId (load checkout.js),
        // then poll /public/pay/{token}/orders/{orderId} until the webhook has recorded the payment.
        this.paying.set(false);
        console.info('Open Razorpay Checkout for', order.orderId);
      },
      error: () => this.paying.set(false),
    });
  }
}
