import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { ParentPayOrder, ParentPayPage, PaymentView } from '../models/models';
import { receiptText } from '../messages/templates';
import { isoDate } from '../../shared/format';
import { ApiService } from './api.service';
import { toPaymentView, toView } from './fee.service';

/**
 * The parent's payment page. No login: the token in the link identifies one student.
 * The real API keeps these endpoints public but rate-limited, and the token random and revocable.
 *
 * Real flow:
 *  1. GET  /public/pay/{token}                 -> page data
 *  2. POST /public/pay/{token}/order {dueIds}  -> Razorpay order; the page opens Razorpay Checkout (UPI)
 *  3. Razorpay webhook -> API records the Payment (mode Online), sends the WhatsApp receipt
 *  4. GET  /public/pay/{token}/orders/{orderId} -> the receipt once the webhook has arrived
 */
@Injectable({ providedIn: 'root' })
export class PublicPayService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  page(token: string): Observable<ParentPayPage> {
    if (!environment.useMock) return this.api.get<ParentPayPage>(`public/pay/${token}`);
    const s = this.mock.snapshot;
    const studentId = token.replace(/^pt_/, '');
    const st = s.students.find((x) => x.id === studentId && x.active);
    if (!st || !s.centre) return this.mock.fail('This payment link is not valid. Please ask the school for a new one.');
    this.mock.ensureDues();
    const dues = s.dues
      .filter((d) => d.studentId === st.id && d.status !== 'Paid')
      .map((d) => toView(d, s))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return this.mock.respond({
      orgName: s.centre.name,
      orgCity: s.centre.city,
      studentName: st.name,
      batchName: s.batches.find((b) => b.id === st.batchId)?.name ?? '',
      dues,
      total: dues.reduce((t, d) => t + d.balance, 0),
      language: s.centre.messageLanguage ?? 'en',
    }, 300);
  }

  createOrder(token: string, dueIds: string[]): Observable<ParentPayOrder> {
    if (!environment.useMock) return this.api.post<ParentPayOrder>(`public/pay/${token}/order`, { dueIds });
    const s = this.mock.snapshot;
    const amount = s.dues.filter((d) => dueIds.includes(d.id)).reduce((t, d) => t + d.amount - d.paidAmount, 0);
    return this.mock.respond({ orderId: 'order_demo_' + Date.now(), amount, keyId: '' }, 400);
  }

  /** Demo only: pretends Razorpay confirmed the payment and records it as the webhook would. */
  confirmDemo(token: string, dueIds: string[]): Observable<PaymentView> {
    if (!environment.useMock) return this.mock.fail('Only available in demo mode.');
    const s = this.mock.snapshot;
    const studentId = token.replace(/^pt_/, '');
    const st = s.students.find((x) => x.id === studentId)!;
    const dues = s.dues.filter((d) => dueIds.includes(d.id) && d.studentId === studentId && d.status !== 'Paid');
    const amount = dues.reduce((t, d) => t + d.amount - d.paidAmount, 0);
    const paidOn = isoDate();
    let view!: PaymentView;
    this.mock.update((state) => {
      const allocations = this.mock.allocate(dues, amount, paidOn);
      const payment = {
        id: this.mock.id('pay'), receiptNo: this.mock.nextReceiptNo(paidOn), studentId, amount, mode: 'Online' as const,
        paidOn, note: 'Paid online by parent', receivedBy: 'Online payment', allocations,
      };
      state.payments.push(payment);
      view = toPaymentView(payment, state);
      this.mock.logMessage({
        studentId, recipientName: st.parentName || `${st.name}'s parent`, phone: st.parentPhone, type: 'Receipt',
        text: receiptText(state.centre?.messageLanguage ?? 'en', { org: state.centre?.name ?? '', student: st.name, amount, receiptNo: payment.receiptNo, balance: view.balanceAfter }),
      });
    });
    return this.mock.respond(view, 1200);
  }
}
