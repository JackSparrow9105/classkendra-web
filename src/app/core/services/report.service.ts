import { Injectable, inject } from '@angular/core';
import { Observable, from } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { CollectionReport, PaymentMode } from '../models/models';
import { monthKey, monthName } from '../../shared/format';
import { ApiService } from './api.service';
import { toPaymentView } from './fee.service';

@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  /**
   * GET /reports/collection?month=
   * Collected = money received in the month (by receipt date). Pending = balance still owed on bills up to that month.
   */
  collection(month = monthKey()): Observable<CollectionReport> {
    if (!environment.useMock) return this.api.get<CollectionReport>('reports/collection', { month });
    this.mock.ensureDues(month);
    const s = this.mock.snapshot;
    const payments = s.payments.filter((p) => p.paidOn.startsWith(month));
    const studentBatch = new Map(s.students.map((st) => [st.id, st.batchId]));

    const modes: PaymentMode[] = ['Cash', 'UPI', 'Cheque', 'Online'];
    const byMode = modes
      .map((mode) => {
        const list = payments.filter((p) => p.mode === mode);
        return { mode, amount: list.reduce((t, p) => t + p.amount, 0), count: list.length };
      })
      .filter((m) => m.count > 0);

    const byGroup = s.batches.map((b) => ({
      batchId: b.id,
      name: b.name,
      collected: payments.filter((p) => studentBatch.get(p.studentId) === b.id).reduce((t, p) => t + p.amount, 0),
      pending: s.dues
        .filter((d) => d.batchId === b.id && d.month <= month && d.status !== 'Paid')
        .reduce((t, d) => t + d.amount - d.paidAmount, 0),
    }));

    const heads = new Map<string, number>();
    for (const p of payments) for (const a of p.allocations) heads.set(a.headName, (heads.get(a.headName) ?? 0) + a.amount);

    const report: CollectionReport = {
      month,
      collected: payments.reduce((t, p) => t + p.amount, 0),
      receiptCount: payments.length,
      discountGiven: s.dues.filter((d) => d.month === month).reduce((t, d) => t + d.discount, 0),
      byMode,
      byGroup,
      byHead: [...heads.entries()].map(([headName, collected]) => ({ headName, collected })).sort((a, b) => b.collected - a.collected),
      payments: payments
        .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.receiptNo.localeCompare(a.receiptNo))
        .map((p) => toPaymentView(p, s)),
    };
    return this.mock.respond(report, 250);
  }

  /**
   * GET /reports/collection.xlsx?month=  (the API builds it with ClosedXML)
   * In demo mode the same workbook is built in the browser so you can see the format.
   */
  collectionExcel(report: CollectionReport, orgName: string, groupLabel: string): Observable<Blob> {
    if (!environment.useMock) return this.api.getBlob('reports/collection.xlsx', { month: report.month });
    return from(buildWorkbook(report, orgName, groupLabel));
  }
}

async function buildWorkbook(r: CollectionReport, orgName: string, groupLabel: string): Promise<Blob> {
  // exceljs is a CommonJS package: depending on the bundler, Workbook is on the module or on its default export.
  const mod = (await import('exceljs')) as unknown as { Workbook?: typeof import('exceljs').Workbook; default?: { Workbook: typeof import('exceljs').Workbook } };
  const Workbook = mod.Workbook ?? mod.default!.Workbook;
  const wb = new Workbook();
  const [y] = r.month.split('-');
  const title = `${orgName} · Collection report · ${monthName(r.month)} ${y}`;
  const money = '₹#,##0';
  const head = (ws: import('exceljs').Worksheet, row: number) => {
    ws.getRow(row).font = { bold: true };
    ws.getRow(row).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0F5' } };
  };

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 30 }, { width: 18 }, { width: 12 }];
  summary.addRow([title]).font = { bold: true, size: 14 };
  summary.addRow([]);
  summary.addRow(['Total collected', r.collected]);
  summary.addRow(['Receipts', r.receiptCount]);
  summary.addRow(['Discounts given on this month’s bills', r.discountGiven]);
  summary.addRow([]);
  summary.addRow(['Payment mode', 'Amount', 'Receipts']);
  head(summary, summary.rowCount);
  r.byMode.forEach((m) => summary.addRow([m.mode, m.amount, m.count]));
  summary.addRow([]);
  summary.addRow(['Fee head', 'Collected']);
  head(summary, summary.rowCount);
  r.byHead.forEach((h) => summary.addRow([h.headName, h.collected]));
  summary.getColumn(2).numFmt = money;
  [3, 5].forEach((n) => (summary.getCell(`B${n}`).numFmt = money));
  summary.getCell('B4').numFmt = '0';

  const groups = wb.addWorksheet(`By ${groupLabel.toLowerCase()}`);
  groups.columns = [
    { header: groupLabel, key: 'name', width: 26 },
    { header: 'Collected', key: 'collected', width: 16, style: { numFmt: money } },
    { header: 'Still pending', key: 'pending', width: 16, style: { numFmt: money } },
  ];
  head(groups, 1);
  r.byGroup.forEach((g) => groups.addRow(g));
  groups.addRow({ name: 'Total', collected: r.byGroup.reduce((t, g) => t + g.collected, 0), pending: r.byGroup.reduce((t, g) => t + g.pending, 0) }).font = { bold: true };

  const receipts = wb.addWorksheet('Receipts');
  receipts.columns = [
    { header: 'Receipt no.', key: 'receiptNo', width: 16 },
    { header: 'Date', key: 'paidOn', width: 12 },
    { header: 'Student', key: 'studentName', width: 24 },
    { header: groupLabel, key: 'batchName', width: 20 },
    { header: 'Fees', key: 'fees', width: 40 },
    { header: 'Mode', key: 'mode', width: 10 },
    { header: 'Amount', key: 'amount', width: 14, style: { numFmt: money } },
    { header: 'Received by', key: 'receivedBy', width: 18 },
  ];
  head(receipts, 1);
  r.payments.forEach((p) =>
    receipts.addRow({
      ...p,
      fees: p.allocations.map((a) => `${a.headName} (${a.periodLabel})`).join(', '),
    }),
  );
  receipts.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
