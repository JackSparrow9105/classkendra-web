import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { Plan } from '../models/models';
import { ApiService } from './api.service';
import { CentreService } from './centre.service';

export type BillingCycle = 'monthly' | 'yearly';

export interface CheckoutResponse {
  /** Razorpay subscription or payment link the owner is sent to. */
  paymentUrl: string;
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);
  private readonly centre = inject(CentreService);

  /** GET /billing/plans — keep prices on the server so you can change them without a release. */
  plans(): Observable<Plan[]> {
    if (!environment.useMock) return this.api.get<Plan[]>('billing/plans');
    return this.mock.respond<Plan[]>([
      { code: 'Starter', name: 'Starter', students: 'Up to 100 students', monthly: 999, yearly: 9990, messages: 1000 },
      { code: 'Growth', name: 'Growth', students: 'Up to 300 students', monthly: 1999, yearly: 19990, messages: 3000, popular: true },
      { code: 'Pro', name: 'Pro', students: 'Up to 600 students', monthly: 3499, yearly: 34990, messages: 6000 },
    ], 150);
  }

  /** POST /billing/checkout  { plan, cycle } -> { paymentUrl } */
  checkout(plan: Plan['code'], cycle: BillingCycle): Observable<CheckoutResponse> {
    if (!environment.useMock) return this.api.post<CheckoutResponse>('billing/checkout', { plan, cycle });
    // Demo only: pretend the payment succeeded straight away.
    this.mock.update((s) => {
      if (s.centre) {
        s.centre.plan = plan;
        s.centre.messageLimit = plan === 'Starter' ? 1000 : plan === 'Growth' ? 3000 : 6000;
      }
    });
    return this.mock.respond({ paymentUrl: '' }, 700).pipe(tap(() => this.centre.load().subscribe()));
  }
}
