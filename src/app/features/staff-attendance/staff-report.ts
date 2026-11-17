import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StaffReport, StaffReportRow } from '../../core/models/models';
import { CentreService } from '../../core/services/centre.service';
import { StaffAttendanceService, STATUS_LABEL, clockLabel } from '../../core/services/staff-attendance.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { Icon } from '../../shared/icon';
import { StaffCalendar } from '../../shared/staff-calendar';
import { ToastService } from '../../shared/toast';
import { monthTitle, thisMonth } from './my-attendance';

/** /staff-attendance/report — per person totals for a month, a calendar per person, Excel download. */
@Component({
  selector: 'app-staff-report',
  imports: [RouterLink, Icon, BottomSheet, StaffCalendar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="row">
          <a routerLink="/staff-attendance" class="icon-btn" aria-label="Back to staff attendance"><app-icon name="chevron-left" /></a>
          <h1 class="page-title">Staff report</h1>
        </div>
        <button type="button" class="btn btn-outline sm" [disabled]="!data() || busy()" (click)="excel()"><app-icon name="download" [size]="16" /> Excel</button>
      </header>

      <div class="month-nav">
        <button type="button" class="icon-btn" aria-label="Previous month" (click)="shift(-1)"><app-icon name="chevron-left" /></button>
        <b>{{ title() }}</b>
        <button type="button" class="icon-btn" aria-label="Next month" [disabled]="month() >= current" (click)="shift(1)"><app-icon name="chevron-right" /></button>
      </div>

      @if (data(); as r) {
        <p class="muted" style="margin: -6px 2px 0; font-size: 13px">{{ rangeText() }} · {{ r.workingDays }} working days{{ r.holidays ? ' · ' + r.holidays + ' holiday' + (r.holidays === 1 ? '' : 's') : '' }}</p>
        @if (r.rows.length === 0) {
          <div class="note"><app-icon name="info" [size]="18" /><span>No teachers or office staff yet.</span></div>
        } @else {
          <section class="card card--list" style="padding: 0; overflow: hidden">
            <table class="report-table">
              <thead><tr><th scope="col">Staff</th><th scope="col" class="ok-t">On time</th><th scope="col" class="warn-t">Late</th><th scope="col" class="acc-t">Leave</th><th scope="col" class="bad-t">Absent</th></tr></thead>
              <tbody>
                @for (p of r.rows; track p.userId) {
                  <tr>
                    <td><button type="button" (click)="person.set(p)"><b style="font-size: 14px">{{ p.name }}</b><span class="muted" style="font-size: 12px">{{ p.role === 'Teacher' ? 'Teacher' : 'Office' }} · see days</span></button></td>
                    <td [class.zero]="!p.counts.present">{{ p.counts.present }}</td>
                    <td [class.zero]="!p.counts.late">{{ p.counts.late }}</td>
                    <td [class.zero]="!p.counts.leave">{{ p.counts.leave }}</td>
                    <td [class.zero]="!p.counts.absent" [class.bad-t]="p.counts.absent > 0">{{ p.counts.absent }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
          <span class="muted" style="font-size: 12px">Tap a name for their day-by-day calendar. The Excel file has these totals and every day with check-in and check-out times.</span>
        }
      }
    </div>

    @if (person(); as p) {
      <app-bottom-sheet [title]="p.name + ' · ' + title()" (closed)="person.set(null)">
        <div class="stack" style="gap: 12px">
          <span class="muted" style="margin-top: -8px">{{ p.counts.present }} on time · {{ p.counts.late }} late · {{ p.counts.leave }} leave · {{ p.counts.absent }} absent</span>
          <app-staff-calendar [days]="p.days" />
        </div>
      </app-bottom-sheet>
    }
  `,
  styleUrl: './staff-attendance.scss',
})
export class StaffReportPage {
  private readonly svc = inject(StaffAttendanceService);
  private readonly centre = inject(CentreService);
  private readonly toast = inject(ToastService);

  protected readonly current = thisMonth();
  protected readonly month = signal(this.current);
  protected readonly data = signal<StaffReport | null>(null);
  protected readonly person = signal<StaffReportRow | null>(null);
  protected readonly busy = signal(false);
  protected readonly title = computed(() => monthTitle(this.month()));
  protected readonly rangeText = computed(() => {
    const r = this.data();
    if (!r) return '';
    const f = new Date(`${r.from}T00:00:00`);
    const t = new Date(`${r.to}T00:00:00`);
    return `${f.getDate()}–${t.getDate()} ${t.toLocaleDateString('en-IN', { month: 'short' })}`;
  });

  constructor() {
    if (!this.centre.centre()) this.centre.load().subscribe();
    effect(() => {
      const m = this.month();
      this.svc.report(m).subscribe({ next: (r) => this.data.set(r), error: (e) => this.toast.show(errorMessage(e)) });
    });
  }

  protected shift(n: number): void {
    const [y, m] = this.month().split('-').map(Number) as [number, number];
    const d = new Date(y, m - 1 + n, 1);
    this.month.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  protected async excel(): Promise<void> {
    const r = this.data();
    if (!r) return;
    this.busy.set(true);
    try {
      const org = this.centre.centre()?.name ?? 'ClassKendra';
      const blob = await buildStaffWorkbook(r, org, this.title());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${org.replace(/[^\w]+/g, '-')}-staff-attendance-${r.month}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch {
      this.toast.show("Couldn't make the Excel file");
    } finally {
      this.busy.set(false);
    }
  }
}

async function buildStaffWorkbook(r: StaffReport, org: string, monthLabel: string): Promise<Blob> {
  const mod = (await import('exceljs')) as unknown as { Workbook?: typeof import('exceljs').Workbook; default?: { Workbook: typeof import('exceljs').Workbook } };
  const Workbook = mod.Workbook ?? mod.default!.Workbook;
  const wb = new Workbook();
  const head = (ws: import('exceljs').Worksheet) => {
    const row = ws.getRow(ws.rowCount);
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0F5' } };
  };

  const sum = wb.addWorksheet('Totals');
  sum.columns = [{ width: 26 }, { width: 10 }, { width: 10 }, { width: 8 }, { width: 8 }, { width: 8 }];
  sum.addRow([`${org} · Staff attendance · ${monthLabel}`]).font = { bold: true, size: 14 };
  sum.addRow([`${r.from} to ${r.to} · ${r.workingDays} working days · ${r.holidays} holidays`]);
  sum.addRow([]);
  sum.addRow(['Name', 'Role', 'On time', 'Late', 'Leave', 'Absent']);
  head(sum);
  r.rows.forEach((p) => sum.addRow([p.name, p.role === 'Teacher' ? 'Teacher' : 'Office', p.counts.present, p.counts.late, p.counts.leave, p.counts.absent]));

  const days = wb.addWorksheet('Every day');
  days.columns = [{ width: 24 }, { width: 12 }, { width: 12 }, { width: 11 }, { width: 11 }, { width: 10 }, { width: 18 }];
  days.addRow(['Name', 'Date', 'Status', 'In', 'Out', 'Late (min)', 'Note']);
  head(days);
  for (const p of r.rows)
    for (const d of p.days) {
      if (d.date > r.to || d.status === 'None' || d.status === 'Upcoming') continue;
      days.addRow([p.name, d.date, STATUS_LABEL[d.status] || d.status, clockLabel(d.checkInAt), clockLabel(d.checkOutAt), d.lateMinutes || '', d.markedByOwner ? 'Marked by owner' : (d.note ?? '')]);
    }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
