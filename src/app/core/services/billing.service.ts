import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { Plan } from '../models/models';
import { ApiService } from './api.service';
import { CentreService } from './centre.service';

export type BillingCycle = 'monthly' | 'yearly';

// Demo (mock) only: the real list comes from the API's Plans table (Database/2026-11-16-new-plans.sql).
const COACHING_PLANS: Plan[] = [
  { code: 'Free', name: 'Free', students: 'Up to 25 students', monthly: 0, yearly: 0, messages: 100, maxStudents: 25 },
  { code: 'TuitionLite', name: 'Tuition Lite', students: 'Up to 50 students', monthly: 399, yearly: 3990, messages: 500, maxStudents: 50 },
  { code: 'Starter', name: 'Starter', students: 'Up to 100 students', monthly: 799, yearly: 7990, messages: 1000, maxStudents: 100 },
  { code: 'Growth', name: 'Growth', students: 'Up to 300 students', monthly: 1999, yearly: 19990, messages: 3000, popular: true, maxStudents: 300 },
  { code: 'Pro', name: 'Pro', students: 'Up to 600 students', monthly: 3499, yearly: 34990, messages: 6000, maxStudents: 600 },
];

const SCHOOL_PLANS: Plan[] = [
  { code: 'School100', name: 'School 100', students: 'Up to 100 students', monthly: 749, yearly: 7490, messages: 300, maxStudents: 100 },
  { code: 'School200', name: 'School 200', students: 'Up to 200 students', monthly: 999, yearly: 9990, messages: 600, popular: true, maxStudents: 200 },
  { code: 'School300', name: 'School 300', students: 'Up to 300 students', monthly: 1299, yearly: 12990, messages: 900, maxStudents: 300 },
  { code: 'School500', name: 'School 500', students: 'Up to 500 students', monthly: 1899, yearly: 18990, messages: 1500, maxStudents: 500 },
  { code: 'School1000', name: 'School 1000', students: 'Up to 1,000 students', monthly: 2999, yearly: 29990, messages: 3000, maxStudents: 1000 },
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
