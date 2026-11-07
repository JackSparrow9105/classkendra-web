import { ChangeDetectionStrategy, Component, NgZone, computed, effect, inject, input, signal } from '@angular/core';
import { catchError, retry } from 'rxjs';
import { environment } from '../../../environments/environment';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { loadRazorpay } from '../../core/razorpay';
import { I18nService, TPipe } from '../../core/i18n/i18n.service';
import { Lang, ParentPayPage, PaymentView } from '../../core/models/models';
import { PublicPayService, RazorpaySuccess } from '../../core/services/public-pay.service';
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
  private readonly zone = inject(NgZone);
  protected readonly i18n = inject(I18nService);

  readonly token = input.required<string>();

  protected readonly page = signal<ParentPayPage | null>(null);
  protected readonly invalid = signal(false);
  protected readonly ticked = signal<Set<string>>(new Set());
  protected readonly paying = signal(false);
  protected readonly receipt = signal<PaymentView | null>(null);
  protected readonly error = signal('');
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
    this.error.set('');
    this.pay.createOrder(this.token(), ids).subscribe({
      next: (order) => {
        if (environment.useMock) {
          this.pay.confirmDemo(this.token(), ids).subscribe((r) => {
            this.paying.set(false);
            this.receipt.set(r);
          });
          return;
        }
        this.openCheckout(order.orderId, order.amount, order.keyId);
      },
      error: (e) => {
        this.paying.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  /** Razorpay Checkout (UPI, cards, net banking). On success the API records the payment and returns the receipt. */
  private openCheckout(orderId: string, amount: number, keyId: string): void {
    const p = this.page()!;
    loadRazorpay()
      .then((Razorpay) => {
        const checkout = new Razorpay({
          key: keyId,
          order_id: orderId,
          amount: amount * 100,
          currency: 'INR',
          name: p.orgName,
          description: `${p.studentName} · ${p.batchName}`,
          theme: { color: '#4f46e5' },
          handler: (res) => this.zone.run(() => this.confirm(orderId, res)),
          modal: { ondismiss: () => this.zone.run(() => this.paying.set(false)) },
        });
        checkout.on('payment.failed', (res) =>
          this.zone.run(() => this.error.set(res.error.description || this.i18n.t('The payment did not go through. Please try again.'))),
        );
        checkout.open();
      })
      .catch((e: unknown) => {
        this.paying.set(false);
        this.error.set(errorMessage(e));
      });
  }

  private confirm(orderId: string, res: RazorpaySuccess): void {
    this.pay
      .confirm(this.token(), res)
      .pipe(
        // If confirming failed, the Razorpay webhook still records it: check the order a few times.
        catchError(() => this.pay.receipt(this.token(), orderId).pipe(retry({ count: 5, delay: 3000 }))),
      )
      .subscribe({
        next: (r) => {
          this.paying.set(false);
          this.receipt.set(r);
        },
        error: () => {
          this.paying.set(false);
          this.error.set(this.i18n.t('Your payment is being confirmed. The receipt will reach you on WhatsApp in a few minutes.'));
        },
      });
  }
}
