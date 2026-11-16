import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Plan } from '../../core/models/models';
import { BillingCycle, BillingService } from '../../core/services/billing.service';
import { CentreService } from '../../core/services/centre.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

@Component({
  selector: 'app-plans',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plans.html',
  styleUrl: './plans.scss',
})
export class Plans {
  private readonly billing = inject(BillingService);
  private readonly toast = inject(ToastService);
  protected readonly centre = inject(CentreService);

  protected readonly plans = signal<Plan[]>([]);
  protected readonly cycle = signal<BillingCycle>('yearly');
  protected readonly busyPlan = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly rupees = rupees;
  protected readonly niceDate = niceDate;

  protected readonly usagePct = computed(() => {
    const c = this.centre.centre();
    return c ? Math.min(100, Math.round((c.messagesUsed / c.messageLimit) * 100)) : 0;
  });

  /** Name of the centre's plan ("School 200"), or its code until the list has loaded. */
  protected readonly currentPlanName = computed(() => {
    const code = this.centre.centre()?.plan;
    return this.plans().find((p) => p.code === code)?.name ?? code ?? '';
  });

  protected readonly features = [
    'All features',
    'Staff and teacher logins',
    'Online fee collection by UPI payment link',
    'Automatic WhatsApp fee reminders and absent alerts',
    '30-day free trial',
    'WhatsApp support from us',
  ];

  constructor() {
    this.billing.plans().subscribe((p) => this.plans.set(p));
    this.centre.load().subscribe();

    // Back from the Razorpay payment page: the webhook switches the plan on within a few seconds.
    const status = inject(ActivatedRoute).snapshot.queryParamMap.get('razorpay_payment_link_status');
    if (status === 'paid') {
      this.toast.show('Payment received. Your plan will be updated in a moment. Thank you!');
      setTimeout(() => this.centre.load().subscribe(), 5000);
    } else if (status) {
      this.error.set('The payment was not completed. You have not been charged; please try again.');
    }
  }

  protected perMonth(p: Plan): number {
    return this.cycle() === 'yearly' ? Math.round(p.yearly / 12) : p.monthly;
  }

  /** "₹5.00" per student per month at the plan's full size ('' for the Free plan or no limit). */
  protected perStudent(p: Plan): string {
    if (!p.monthly || !p.maxStudents) return '';
    const monthly = this.cycle() === 'yearly' ? p.yearly / 12 : p.monthly;
    return '₹' + (Math.round((monthly * 100) / p.maxStudents) / 100).toFixed(2);
  }

  protected choose(p: Plan): void {
    this.error.set('');
    this.busyPlan.set(p.code);
    this.billing.checkout(p.code, this.cycle()).subscribe({
      next: (res) => {
        this.busyPlan.set(null);
        if (res.paymentUrl) {
          window.location.href = res.paymentUrl;
          return;
        }
        this.toast.show(`You're on the ${p.name} plan. Thank you!`);
      },
      error: (e) => {
        this.busyPlan.set(null);
        this.error.set(errorMessage(e));
      },
    });
  }
}
