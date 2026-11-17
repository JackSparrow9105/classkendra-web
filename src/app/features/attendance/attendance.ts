import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Batch, Student } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { I18nService, TPipe } from '../../core/i18n/i18n.service';
import { AttendanceService } from '../../core/services/attendance.service';
import { OfflineAttendanceService } from '../../core/services/offline-attendance.service';
import { AuthService } from '../../core/services/auth.service';
import { StaffAttendanceService } from '../../core/services/staff-attendance.service';
import { BatchService } from '../../core/services/batch.service';
import { StudentService } from '../../core/services/student.service';
import { initials, isoDate, longDate } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';
import { errorMessage } from '../../core/interceptors/auth.interceptor';

@Component({
  selector: 'app-attendance',
  imports: [RouterLink, Icon, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss',
})
export class Attendance {
  private readonly attendance = inject(AttendanceService);
  private readonly batchService = inject(BatchService);
  private readonly studentService = inject(StudentService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  protected readonly labels = inject(LabelService);
  protected readonly auth = inject(AuthService);
  protected readonly staffAtt = inject(StaffAttendanceService);
  private readonly i18n = inject(I18nService);
  /** Registers saved on this phone while offline, waiting to be sent. */
  protected readonly outbox = inject(OfflineAttendanceService);
  /** This register is saved on the phone but not sent yet. */
  protected readonly waitingToSend = computed(() => !!this.outbox.waiting().find((i) => i.batchId === this.batchId() && i.date === this.date()));

  protected readonly today = isoDate();
  protected readonly date = signal(this.today);
  protected readonly batches = signal<Batch[]>([]);
  protected readonly batchId = signal('');
  protected readonly students = signal<Student[]>([]);
  protected readonly absent = signal<Set<string>>(new Set());
  protected readonly saved = signal(false);
  /** Set when the chosen day is a holiday (Settings › Holidays): no absent alerts are sent. */
  protected readonly holiday = signal<string | null>(null);
  protected readonly dirty = signal(false);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly initials = initials;
  protected readonly longDate = longDate;

  protected readonly absentCount = computed(() => this.absent().size);
  protected readonly presentCount = computed(() => this.students().length - this.absentCount());
  protected readonly saveLabel = computed(() => {
    const n = this.absentCount();
    const t = (k: string, p?: Record<string, number>) => this.i18n.t(k, p);
    if (this.saved() && !this.dirty()) return t('Saved');
    if (this.holiday()) return t('Save');
    return n === 0 ? t('Save · everyone present') : n === 1 ? t('Save · alert 1 parent') : t('Save · alert {n} parents', { n });
  });

  constructor() {
    if (this.auth.isOwner()) this.staffAtt.status().subscribe({ error: () => undefined });
    this.batchService.list().subscribe((list) => {
      this.batches.set(list);
      // ?batch=<id> (from the teacher's Home) opens that register; otherwise the first batch.
      const wanted = this.route.snapshot.queryParamMap.get('batch');
      const first = list.find((b) => b.id === wanted) ?? list[0];
      if (first) this.pickBatch(first.id);
      else this.loading.set(false);
    });
  }

  protected pickBatch(id: string): void {
    this.batchId.set(id);
    this.load();
  }

  protected setDate(value: string): void {
    if (!value) return;
    this.date.set(value > this.today ? this.today : value);
    this.load();
  }

  protected toggle(id: string): void {
    this.absent.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    this.dirty.set(true);
  }

  protected save(): void {
    const batchName = this.batches().find((b) => b.id === this.batchId())?.name ?? '';
    const keepOnPhone = () => {
      this.outbox.add({ batchId: this.batchId(), batchName, date: this.date(), absentStudentIds: [...this.absent()] });
      this.busy.set(false);
      this.saved.set(true);
      this.dirty.set(false);
      this.toast.show(this.i18n.t('No internet. Saved on this phone; it will be sent when you are back online.'));
    };
    // No connection: keep it on the phone straight away instead of waiting for the request to fail.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return keepOnPhone();

    this.busy.set(true);
    this.attendance.save(this.batchId(), this.date(), [...this.absent()]).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.saved.set(true);
        this.dirty.set(false);
        const n = res.alerted;
        this.toast.show(
          n === 0 ? this.i18n.t('Attendance saved')
            : n === 1 ? this.i18n.t('Saved. 1 parent alerted on WhatsApp.')
            : this.i18n.t('Saved. {n} parents alerted on WhatsApp.', { n }),
        );
      },
      error: (err) => {
        if (OfflineAttendanceService.isOffline(err)) return keepOnPhone();
        this.busy.set(false);
        this.toast.show(errorMessage(err));
      },
    });
  }

  protected sendNow(): void {
    this.outbox.sync();
  }

  private load(): void {
    this.loading.set(true);
    forkJoin([
      this.studentService.list({ batchId: this.batchId() }),
      this.attendance.get(this.batchId(), this.date()),
    ]).subscribe({
      next: ([students, sheet]) => {
        this.students.set(students);
        // A copy saved on this phone and not sent yet is newer than the server's.
        const waiting = this.outbox.find(this.batchId(), this.date());
        this.absent.set(new Set(waiting ? waiting.absentStudentIds : sheet.absentStudentIds));
        this.saved.set(sheet.saved || !!waiting);
        this.holiday.set(sheet.holidayName ?? null);
        this.dirty.set(false);
        this.loading.set(false);
      },
      // Don't leave an empty register on screen without saying why.
      error: (err) => {
        this.students.set([]);
        this.loading.set(false);
        this.toast.show(errorMessage(err));
      },
    });
  }
}
