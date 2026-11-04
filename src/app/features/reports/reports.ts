import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CollectionReport } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { CentreService } from '../../core/services/centre.service';
import { ReportService } from '../../core/services/report.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { monthKey, monthName, niceDate, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

@Component({
  selector: 'app-reports',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports {
  private readonly reports = inject(ReportService);
  private readonly centre = inject(CentreService);
  private readonly toast = inject(ToastService);
  protected readonly labels = inject(LabelService);

  protected readonly month = signal(monthKey());
  protected readonly report = signal<CollectionReport | null>(null);
  protected readonly downloading = signal(false);
  protected readonly showAllReceipts = signal(false);
  protected readonly rupees = rupees;
  protected readonly niceDate = niceDate;
  protected readonly monthName = monthName;

  protected readonly months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    return monthKey(d);
  });

  /** Bar widths as a share of the biggest value in each section. */
  protected readonly maxMode = computed(() => Math.max(1, ...(this.report()?.byMode.map((m) => m.amount) ?? [])));
  protected readonly maxHead = computed(() => Math.max(1, ...(this.report()?.byHead.map((h) => h.collected) ?? [])));
  protected readonly groupsWithActivity = computed(() =>
    (this.report()?.byGroup ?? []).filter((g) => g.collected > 0 || g.pending > 0),
  );
  protected readonly receipts = computed(() => {
    const list = this.report()?.payments ?? [];
    return this.showAllReceipts() ? list : list.slice(0, 8);
  });

  constructor() {
    if (!this.centre.centre()) this.centre.load().subscribe();
    this.load();
  }

  protected setMonth(m: string): void {
    this.month.set(m);
    this.showAllReceipts.set(false);
    this.load();
  }

  protected download(): void {
    const r = this.report();
    if (!r) return;
    this.downloading.set(true);
    const org = this.centre.centre()?.name ?? 'ClassKendra';
    this.reports.collectionExcel(r, org, this.labels.l().group).subscribe({
      next: (blob) => {
        this.downloading.set(false);
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), {
          href: url,
          download: `${org.replace(/[^\w]+/g, '-')}-collection-${r.month}.xlsx`,
        });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: (e) => {
        this.downloading.set(false);
        this.toast.show(errorMessage(e));
      },
    });
  }

  private load(): void {
    this.report.set(null);
    this.reports.collection(this.month()).subscribe((r) => this.report.set(r));
  }
}
