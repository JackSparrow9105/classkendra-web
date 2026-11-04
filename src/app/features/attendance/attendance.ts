import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Batch, Student } from '../../core/models/models';
import { AttendanceService } from '../../core/services/attendance.service';
import { BatchService } from '../../core/services/batch.service';
import { StudentService } from '../../core/services/student.service';
import { initials, isoDate, longDate } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

@Component({
  selector: 'app-attendance',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss',
})
export class Attendance {
  private readonly attendance = inject(AttendanceService);
  private readonly batchService = inject(BatchService);
  private readonly studentService = inject(StudentService);
  private readonly toast = inject(ToastService);

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
    if (this.saved() && !this.dirty()) return 'Saved';
    return n === 0 ? 'Save · everyone present' : `Save · alert ${n} ${n === 1 ? 'parent' : 'parents'}`;
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
      this.toast.show(res.alerted ? `Saved. ${res.alerted} ${res.alerted === 1 ? 'parent' : 'parents'} alerted on WhatsApp.` : 'Attendance saved');
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
