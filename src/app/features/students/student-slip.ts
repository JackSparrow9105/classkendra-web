import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { StudentFeeHistory } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { CentreService, logoUrl } from '../../core/services/centre.service';
import { FeeService } from '../../core/services/fee.service';
import { isoDate, longDate, niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';

type SlipKind = 'statement' | 'due' | 'nodues';

/**
 * /students/:id/slip/:kind — printable slips from the student's fee history:
 *   statement  every fee and payment this session (plus older unpaid fees), with totals and the balance
 *   due        what is owed now and by when, with the parent's payment link
 *   nodues     no-dues certificate — only when nothing is owed
 * Each can be printed, saved as PDF (the browser's print dialog) or shared as text on WhatsApp.
 */
@Component({
  selector: 'app-student-slip',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../receipts/receipt.scss'],
  template: `
    <div class="page">
      <header class="page-head no-print">
        <div class="row">
          <a [routerLink]="['/students', id()]" [queryParams]="{ tab: 'slips' }" class="icon-btn" aria-label="Back to student"><app-icon name="chevron-left" /></a>
          <h1 class="page-title">{{ title() }}</h1>
        </div>
      </header>

      @if (d(); as d) {
        @if (kind() === 'nodues' && d.balance > 0) {
          <div class="note warn" role="alert">
            <app-icon name="info" [size]="18" />
            <span>{{ d.student.name }} still owes {{ rupees(d.balance) }}. A no-dues certificate can be given once everything is paid or waived.
              <a [routerLink]="['/students', id()]" [queryParams]="{ tab: 'fees' }">See fees</a></span>
          </div>
        } @else {
          <article class="receipt" [attr.aria-label]="title()">
            <header class="r-head">
              <div class="r-org">
                @if (logo(); as src) { <img class="r-logo" [src]="src" alt="" (error)="logoFailed.set(true)"> }
                @if (centre.centre(); as c) {
                  <div class="r-org-text">
                    <strong class="org">{{ c.name }}</strong>
                    @if (c.address) { <span class="muted r-address">{{ c.address }}</span> } @else if (c.city) { <span class="muted">{{ c.city }}</span> }
                    @if (c.phone) { <span class="muted">Phone: {{ c.phone }}</span> }
                  </div>
                }
              </div>
              <div class="r-no">
                <span class="muted">{{ title() }}</span>
                <strong>{{ longDate(today) }}</strong>
              </div>
            </header>

            <dl class="r-meta">
              <div><dt>Student</dt><dd>{{ d.student.name }}</dd></div>
              <div><dt>{{ labels.l().group }}</dt><dd>{{ d.batchName }}</dd></div>
              @if (d.student.admissionNo) { <div><dt>Admission no.</dt><dd>{{ d.student.admissionNo }}</dd></div> }
              @if (d.student.parentName) { <div><dt>Parent</dt><dd>{{ d.student.parentName }}</dd></div> }
              <div><dt>Parent's mobile</dt><dd>+91 {{ d.student.parentPhone }}</dd></div>
            </dl>

            @switch (kind()) {
              @case ('statement') {
                <table class="r-table">
                  <thead><tr><th scope="col">Fee</th><th scope="col">Due</th><th scope="col" class="num">Amount</th><th scope="col" class="num">Paid</th><th scope="col" class="num">Balance</th></tr></thead>
                  <tbody>
                    @for (f of fees(); track f.id) {
                      <tr>
                        <td>{{ f.headName }} · {{ f.periodLabel }}@if (f.discount > 0) { <br><span class="muted">{{ rupees(f.discount) }} off</span> }</td>
                        <td>{{ niceDate(f.dueDate) }}</td>
                        <td class="num">{{ rupees(f.amount) }}</td>
                        <td class="num">{{ rupees(f.paidAmount) }}</td>
                        <td class="num">{{ rupees(f.balance) }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="5" class="muted">No fees this session.</td></tr>
                    }
                  </tbody>
                  <tfoot>
                    <tr><th scope="row" colspan="2">Total</th><td class="num">{{ rupees(totals().charged) }}</td><td class="num">{{ rupees(totals().paid) }}</td><td class="num total">{{ rupees(d.balance) }}</td></tr>
                  </tfoot>
                </table>

                @if (receipts().length) {
                  <table class="r-table">
                    <thead><tr><th scope="col">Receipt</th><th scope="col">Date</th><th scope="col">Mode</th><th scope="col" class="num">Amount</th></tr></thead>
                    <tbody>
                      @for (p of receipts(); track p.id) {
                        <tr><td>{{ p.mode === 'Opening' ? 'Advance before ClassKendra' : p.receiptNo }}</td><td>{{ niceDate(p.paidOn) }}</td><td>{{ p.mode === 'Opening' ? '—' : p.mode }}</td><td class="num">{{ rupees(p.amount) }}</td></tr>
                      }
                      @for (r of d.refunds ?? []; track r.id) {
                        <tr><td>Refund {{ r.refundNo }}</td><td>{{ niceDate(r.refundedOn) }}</td><td>{{ r.mode }}</td><td class="num">− {{ rupees(r.amount) }}</td></tr>
                      }
                    </tbody>
                  </table>
                }

                <div class="r-foot">
                  @if (d.balance > 0) { <span class="badge warn">Balance due {{ rupees(d.balance) }}</span> } @else { <span class="badge ok">No balance due</span> }
                  @if ((d.advance ?? 0) > 0) { <span class="muted">Advance {{ rupees(d.advance!) }}</span> }
                </div>
              }

              @case ('due') {
                @if (unpaid().length) {
                  <table class="r-table">
                    <thead><tr><th scope="col">Fee</th><th scope="col">Due date</th><th scope="col" class="num">To pay</th></tr></thead>
                    <tbody>
                      @for (f of unpaid(); track f.id) {
                        <tr>
                          <td>{{ f.headName }} · {{ f.periodLabel }}</td>
                          <td>{{ niceDate(f.dueDate) }}@if (f.daysLate > 0) { <br><span class="muted">{{ f.daysLate }} days late</span> }</td>
                          <td class="num">{{ rupees(f.balance) }}</td>
                        </tr>
                      }
                    </tbody>
                    <tfoot><tr><th scope="row" colspan="2">Total to pay</th><td class="num total">{{ rupees(d.balance) }}</td></tr></tfoot>
                  </table>
                  <p class="r-note">Please pay {{ payBy() }} at the office, or online: <strong class="pay-link">{{ d.payLink }}</strong></p>
                } @else {
                  <p class="muted">Nothing is due right now. Thank you!</p>
                }
              }

              @case ('nodues') {
                <div class="cert">
                  <h2>No-dues certificate</h2>
                  <p>
                    This is to certify that <strong>{{ d.student.name }}</strong>@if (d.student.parentName) {, child of <strong>{{ d.student.parentName }}</strong>},
                    @if (d.student.admissionNo) { admission no. <strong>{{ d.student.admissionNo }}</strong>, } {{ d.student.active ? 'studying' : 'who studied' }} in
                    <strong>{{ d.batchName }}</strong>, has paid all fees due to <strong>{{ centre.centre()?.name }}</strong> up to {{ longDate(today) }}.
                    No dues are pending.
                  </p>
                  <div class="sign">
                    <span class="muted">Date: {{ longDate(today) }}</span>
                    <span class="sign-line">Authorised signatory</span>
                  </div>
                </div>
              }
            }
            <p class="r-note muted">Generated by ClassKendra on {{ longDate(today) }}.</p>
          </article>

          <div class="stack no-print">
            <a class="btn btn-primary lg block" [href]="whatsappUrl()" target="_blank" rel="noopener">
              <app-icon name="whatsapp" [size]="18" /> Share on WhatsApp
            </a>
            <button type="button" class="btn btn-outline lg block" (click)="print()">
              <app-icon name="file" [size]="18" /> Print or save as PDF
            </button>
          </div>
        }
      } @else {
        <p class="muted">Loading…</p>
      }
    </div>
  `,
  styles: `
    .pay-link { word-break: break-all; }
    .cert h2 { text-align: center; font-size: 20px; margin: 8px 0 14px; letter-spacing: 0.5px; }
    .cert p { line-height: 1.8; font-size: 15px; }
    .sign { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 48px; gap: 16px; }
    .sign-line { border-top: 1px solid currentColor; padding-top: 6px; min-width: 180px; text-align: center; font-size: 13px; }
  `,
})
export class StudentSlip {
  private readonly feeService = inject(FeeService);
  private readonly router = inject(Router);
  protected readonly centre = inject(CentreService);
  protected readonly labels = inject(LabelService);

  readonly id = input.required<string>();
  readonly kind = input.required<SlipKind>();

  protected readonly d = signal<StudentFeeHistory | null>(null);
  protected readonly logoFailed = signal(false);
  protected readonly today = isoDate();
  protected readonly rupees = rupees;
  protected readonly niceDate = niceDate;
  protected readonly longDate = longDate;

  protected readonly title = computed(() =>
    this.kind() === 'statement' ? 'Fee statement' : this.kind() === 'due' ? 'Fee due slip' : 'No-dues certificate',
  );
  protected readonly logo = computed(() => (this.logoFailed() ? null : logoUrl(this.centre.centre()?.logoId)));
  /** Oldest first for printing. */
  protected readonly fees = computed(() => [...(this.d()?.dues ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.headName.localeCompare(b.headName)));
  protected readonly unpaid = computed(() => this.fees().filter((f) => f.balance > 0));
  protected readonly receipts = computed(() =>
    [...(this.d()?.payments ?? [])].filter((p) => !p.cancelled).sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.receiptNo.localeCompare(b.receiptNo)),
  );
  protected readonly totals = computed(() => ({
    charged: this.fees().reduce((t, f) => t + f.amount, 0),
    paid: this.fees().reduce((t, f) => t + f.paidAmount, 0),
  }));
  /** "by 10 Dec" for fees not yet due, "now" when something is already late. */
  protected readonly payBy = computed(() => {
    const first = this.unpaid()[0];
    if (!first) return '';
    return first.dueDate <= this.today ? 'now' : `by ${niceDate(first.dueDate)}`;
  });

  protected readonly whatsappUrl = computed(() => {
    const d = this.d();
    const c = this.centre.centre();
    if (!d) return '';
    const head = `${c?.name ?? ''}${c?.phone ? ` · ${c.phone}` : ''}\n${this.title()} · ${niceDate(this.today)}\n${d.student.name} (${d.batchName})${d.student.admissionNo ? ` · ${d.student.admissionNo}` : ''}\n`;
    let body = '';
    if (this.kind() === 'statement') {
      body = `Fees this session: ${rupees(this.totals().charged)}\nPaid: ${rupees(this.totals().paid)}\n` +
        (d.balance > 0 ? `Balance due: ${rupees(d.balance)}` : 'No balance due') + ((d.advance ?? 0) > 0 ? `\nAdvance: ${rupees(d.advance!)}` : '');
    } else if (this.kind() === 'due') {
      body = this.unpaid().map((f) => `• ${f.headName} (${f.periodLabel}), due ${niceDate(f.dueDate)}: ${rupees(f.balance)}`).join('\n') +
        `\nTotal to pay: ${rupees(d.balance)}\nPay online: ${d.payLink}`;
    } else {
      body = `This is to certify that ${d.student.name} has paid all fees due to ${c?.name ?? 'us'} up to ${longDate(this.today)}. No dues are pending.`;
    }
    return `https://wa.me/91${d.student.parentPhone}?text=${encodeURIComponent(head + body)}`;
  });

  constructor() {
    if (!this.centre.centre()) this.centre.load().subscribe();
    effect(() => {
      const kind = this.kind();
      if (!['statement', 'due', 'nodues'].includes(kind)) {
        this.router.navigate(['/students', this.id()]);
        return;
      }
      this.feeService.history(this.id()).subscribe({
        next: (h) => this.d.set(h),
        error: () => this.router.navigateByUrl('/students'),
      });
    });
  }

  protected print(): void {
    window.print();
  }
}
