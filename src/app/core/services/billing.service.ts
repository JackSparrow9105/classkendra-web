import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { Plan } from '../models/models';
import { ApiService } from './api.service';
import { CentreService } from './centre.service';

export type BillingCycle = 'monthly' | 'yearly';

const COACHING_PLANS: Plan[] = [
  { code: 'Starter', name: 'Starter', students: 'Up to 100 students', monthly: 999, yearly: 9990, messages: 1000 },
  { code: 'Growth', name: 'Growth', students: 'Up to 300 students', monthly: 1999, yearly: 19990, messages: 3000, popular: true },
  { code: 'Pro', name: 'Pro', students: 'Up to 600 students', monthly: 3499, yearly: 34990, messages: 6000 },
];

const SCHOOL_PLANS: Plan[] = [
  { code: 'School', name: 'School', students: 'Up to 500 students', monthly: 2999, yearly: 29990, messages: 5000 },
  { code: 'SchoolPlus', name: 'School Plus', students: 'Up to 1,500 students', monthly: 5999, yearly: 59990, messages: 15000, popular: true },
  { code: 'SchoolMax', name: 'School Max', students: 'Up to 3,000 students', monthly: 9999, yearly: 99990, messages: 30000 },
];

export interface CheckoutResponse {
  /** Razorpay Payment Link the owner is sent to; it returns to /plans?razorpay_payment_link_status=paid. */
  paymentUrl: string;
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);
  private readonly centre = inject(CentreService);

  /**
   * GET /billing/plans — the API returns coaching or school plans for the signed-in centre.
   * Keep prices on the server so you can change them without a release.
   * School prices below are placeholders: confirm them with your first schools.
   */
  plans(): Observable<Plan[]> {
    if (!environment.useMock) return this.api.get<Plan[]>('billing/plans');
    const isSchool = this.mock.snapshot.centre?.institutionType === 'School';
    return this.mock.respond<Plan[]>(isSchool ? SCHOOL_PLANS : COACHING_PLANS, 150);
  }

  /** POST /billing/checkout  { plan, cycle } -> { paymentUrl } */
  checkout(plan: Plan['code'], cycle: BillingCycle): Observable<CheckoutResponse> {
    if (!environment.useMock) return this.api.post<CheckoutResponse>('billing/checkout', { plan, cycle });
    // Demo only: pretend the payment succeeded straight away.
    this.mock.update((s) => {
      if (s.centre) {
        s.centre.plan = plan;
        s.centre.messageLimit = [...COACHING_PLANS, ...SCHOOL_PLANS].find((p) => p.code === plan)?.messages ?? 1000;
      }
    });
    return this.mock.respond({ paymentUrl: '' }, 700).pipe(tap(() => this.centre.load().subscribe()));
  }
}
