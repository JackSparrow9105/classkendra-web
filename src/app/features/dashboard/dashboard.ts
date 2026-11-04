import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { DashboardSummary, StudentFees } from '../../core/models/models';
import { MockDb } from '../../core/mock/mock-db';
import { LabelService } from '../../core/labels';
import { CentreService } from '../../core/services/centre.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { FeeService } from '../../core/services/fee.service';
import { initials, monthName, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, Icon],
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
    this.fees.remind([row.studentId]).subscribe(() => this.toast.show(`Reminder sent to ${row.studentName}'s parent`));
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
