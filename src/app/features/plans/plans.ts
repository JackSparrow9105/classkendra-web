import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
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

  protected readonly features = [
    'Automatic WhatsApp fee reminders',
    'Absent alerts to parents',
    'Online fee collection by UPI',
    'Staff logins',
    'WhatsApp support from us',
  ];

  constructor() {
    this.billing.plans().subscribe((p) => this.plans.set(p));
    this.centre.load().subscribe();
  }

  protected perMonth(p: Plan): number {
    return this.cycle() === 'yearly' ? Math.round(p.yearly / 12) : p.monthly;
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
