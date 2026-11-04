import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Batch, Student } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { I18nService, TPipe } from '../../core/i18n/i18n.service';
import { AttendanceService } from '../../core/services/attendance.service';
import { AuthService } from '../../core/services/auth.service';
import { BatchService } from '../../core/services/batch.service';
import { StudentService } from '../../core/services/student.service';
import { initials, isoDate, longDate } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

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
  protected readonly labels = inject(LabelService);
  protected readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);

  protected readonly today = isoDate();
  protected readonly date = signal(this.today);
  protected readonly batches = signal<Batch[]>([]);
  protected readonly batchId = signal('');
  protected readonly students = signal<Student[]>([]);
  protected readonly absent = signal<Set<string>>(new Set());
  protected readonly saved = signal(false);
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
    return n === 0 ? t('Save · everyone present') : n === 1 ? t('Save · alert 1 parent') : t('Save · alert {n} parents', { n });
  });

  constructor() {
    this.batchService.list().subscribe((list) => {
      this.batches.set(list);
      if (list.length) this.pickBatch(list[0]!.id);
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
    this.busy.set(true);
    this.attendance.save(this.batchId(), this.date(), [...this.absent()]).subscribe((res) => {
      this.busy.set(false);
      this.saved.set(true);
      this.dirty.set(false);
      const n = res.alerted;
      this.toast.show(
        n === 0 ? this.i18n.t('Attendance saved')
          : n === 1 ? this.i18n.t('Saved. 1 parent alerted on WhatsApp.')
          : this.i18n.t('Saved. {n} parents alerted on WhatsApp.', { n }),
      );
    });
  }

  private load(): void {
    this.loading.set(true);
    forkJoin([
      this.studentService.list({ batchId: this.batchId() }),
      this.attendance.get(this.batchId(), this.date()),
    ]).subscribe(([students, sheet]) => {
      this.students.set(students);
      this.absent.set(new Set(sheet.absentStudentIds));
      this.saved.set(sheet.saved);
      this.dirty.set(false);
      this.loading.set(false);
    });
  }
}
