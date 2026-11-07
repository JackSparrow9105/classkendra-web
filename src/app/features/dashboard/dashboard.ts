import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { DashboardSummary, StudentFees } from '../../core/models/models';
import { MockDb } from '../../core/mock/mock-db';
import { LabelService } from '../../core/labels';
import { CentreService } from '../../core/services/centre.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { FeeService } from '../../core/services/fee.service';
import { initials, isoDate, monthName, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';
import { TPipe } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, Icon, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly dashboard = inject(DashboardService);
  private readonly fees = inject(FeeService);
  private readonly toast = inject(ToastService);
  private readonly mock = inject(MockDb);
  protected readonly centre = inject(CentreService);
  protected readonly labels = inject(LabelService);

  protected readonly data = signal<DashboardSummary | null>(null);
  protected readonly reminding = signal(false);
  protected readonly isDemo = environment.useMock;
  protected readonly rupees = rupees;
  protected readonly initials = initials;
  protected readonly monthName = monthName;

  protected readonly greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();

  protected readonly setupDone = computed(() => {
    const d = this.data();
    return !!d && d.studentCount > 0 && d.feesConfigured;
  });

  protected readonly collectedPct = computed(() => {
    const d = this.data();
    return d && d.expected ? Math.round((d.collected / d.expected) * 100) : 0;
  });

  protected readonly attendancePct = computed(() => {
    const d = this.data();
    return d && d.markedToday ? Math.round((d.presentToday / d.markedToday) * 100) : null;
  });

  // ---------- Desktop (wide) dashboard ----------

  protected readonly today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  protected readonly ins = computed(() => this.data()?.insights ?? null);

  /** Bars for the 6-month chart, scaled to the biggest month. */
  protected readonly trend = computed(() => {
    const t = this.ins()?.trend ?? [];
    const max = Math.max(1, ...t.map((m) => Math.max(m.billed, m.collected)));
    return t.map((m) => ({
      label: new Date(m.month + '-01T00:00:00').toLocaleString('en-IN', { month: 'short' }),
      billedPct: Math.round((m.billed / max) * 100),
      collectedPct: Math.round((m.collected / max) * 100),
      rate: m.billed ? Math.min(100, Math.round((m.collected / m.billed) * 100)) + '%' : '–',
      title: `${rupees(m.collected)} of ${rupees(m.billed)}`,
    }));
  });

  protected readonly batchRows = computed(() =>
    (this.ins()?.batches ?? []).map((b) => ({
      ...b,
      pct: b.billed ? Math.min(100, Math.round((b.collected / b.billed) * 100)) : 0,
    })),
  );

  /** Today's classes and payments in time order. */
  protected readonly timeline = computed(() => {
    const ins = this.ins();
    if (!ins) return [];
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };
    const label = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = String(mins % 60).padStart(2, '0');
      return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
    };
    const items: {
      key: string;
      at: number;
      time: string;
      title: string;
      sub: string;
      kind: 'done' | 'pay' | 'next';
    }[] = [];

    for (const c of ins.classesToday) {
      const at = c.startTime ? toMin(c.startTime) : 0;
      const marked = c.present !== null;
      items.push({
        key: 'c' + c.batchId,
        at,
        time: c.startTime ? label(at) : 'Today',
        title: c.name,
        sub: marked
          ? `${c.present} of ${c.students} present` + (c.teacher ? ` · ${c.teacher}` : '')
          : `${c.students} students` + (c.teacher ? ` · ${c.teacher}` : ''),
        kind: marked ? 'done' : 'next',
      });
    }

    const todayIso = isoDate();
    for (const p of ins.recentPayments) {
      if (p.paidOn !== todayIso || !p.at) continue;
      const d = new Date(p.at);
      const at = d.getHours() * 60 + d.getMinutes();
      items.push({
        key: 'p' + p.id,
        at,
        time: label(at),
        title: `${rupees(p.amount)} from ${p.studentName}`,
        sub: `${p.mode} · ${p.receiptNo}`,
        kind: 'pay',
      });
    }
    return items.sort((a, b) => a.at - b.at);
  });

  protected paymentTime(p: { paidOn: string; at: string | null }): string {
    if (p.paidOn === isoDate() && p.at) {
      return new Date(p.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    }
    return new Date(p.paidOn + 'T00:00:00').toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    });
  }

  constructor() {
    this.load();
  }

  protected remindAll(): void {
    this.reminding.set(true);
    this.fees.remindAll().subscribe((r) => {
      this.reminding.set(false);
      this.toast.show(`${r.sent} reminders queued on WhatsApp`);
      this.centre.load().subscribe();
    });
  }

  protected remind(row: StudentFees): void {
    this.fees
      .remind([row.studentId])
      .subscribe(() => this.toast.show(`Reminder sent to ${row.studentName}'s parent`));
  }

  /** Demo mode only: fill the account with sample students, fees and payments. */
  protected loadSample(): void {
    this.mock.seedSample();
    this.toast.show('Sample data added');
    this.load();
  }

  private load(): void {
    this.dashboard.summary().subscribe((d) => this.data.set(d));
  }
}
