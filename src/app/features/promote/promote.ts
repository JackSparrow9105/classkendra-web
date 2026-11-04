import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Batch, PromotionResult, Student } from '../../core/models/models';
import { LabelService, SCHOOL_CLASSES, schoolGroupName } from '../../core/labels';
import { BatchService } from '../../core/services/batch.service';
import { StudentService } from '../../core/services/student.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { Icon } from '../../shared/icon';

/** 'stay' = nobody moves, 'leave' = passed out / left, otherwise the target batch id. */
type Target = string;

interface Row {
  batch: Batch;
  students: Student[];
  target: Target;
  /** Students ticked to move; unticked ones stay back. */
  moving: Set<string>;
  open: boolean;
  /** For schools: the next class name when it doesn't exist yet, so it can be created in one tap. */
  missingNext: { className: string; section: string | null } | null;
}

@Component({
  selector: 'app-promote',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './promote.html',
  styleUrl: './promote.scss',
})
export class Promote {
  private readonly batchService = inject(BatchService);
  private readonly studentService = inject(StudentService);
  protected readonly labels = inject(LabelService);

  protected readonly batches = signal<Batch[]>([]);
  protected readonly rows = signal<Row[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly result = signal<PromotionResult | null>(null);

  protected readonly summary = computed(() => {
    let move = 0;
    let leave = 0;
    let keep = 0;
    for (const r of this.rows()) {
      if (r.target === 'stay' || r.target === '') continue;
      const going = r.students.filter((s) => r.moving.has(s.id)).length;
      keep += r.students.length - going;
      if (r.target === 'leave') leave += going;
      else move += going;
    }
    return { move, leave, keep };
  });

  protected readonly unresolved = computed(() => this.rows().filter((r) => r.target === '' && r.students.length > 0));

  constructor() {
    this.load();
  }

  protected targetName(t: Target): string {
    if (t === 'leave') return 'Passed out / leaving';
    if (t === 'stay' || t === '') return '';
    return this.batches().find((b) => b.id === t)?.name ?? '';
  }

  protected setTarget(row: Row, t: Target): void {
    this.patch(row.batch.id, { target: t });
  }

  protected toggleOpen(row: Row): void {
    this.patch(row.batch.id, { open: !row.open });
  }

  protected toggleStudent(row: Row, id: string): void {
    const moving = new Set(row.moving);
    if (moving.has(id)) moving.delete(id);
    else moving.add(id);
    this.patch(row.batch.id, { moving });
  }

  /** Creates the missing next class (e.g. Class 9 · A) and points this row at it. */
  protected createNext(row: Row): void {
    const n = row.missingNext;
    if (!n) return;
    this.batchService
      .create({ name: schoolGroupName(n.className, n.section), className: n.className, section: n.section, days: null, startTime: null, endTime: null })
      .subscribe({
        next: (b) => {
          this.batches.update((list) => [...list, b]);
          this.patch(row.batch.id, { target: b.id, missingNext: null });
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
  }

  protected run(): void {
    const s = this.summary();
    if (this.unresolved().length) {
      this.error.set(`Choose where ${this.unresolved().map((r) => r.batch.name).join(', ')} should go.`);
      return;
    }
    if (s.move + s.leave === 0) {
      this.error.set('Nothing to move. Choose a new class for at least one group.');
      return;
    }
    const msg = `Move ${s.move} students up${s.leave ? `, mark ${s.leave} as leaving` : ''}${s.keep ? ` and keep ${s.keep} back` : ''}? Do this once, at the start of the session.`;
    if (!confirm(msg)) return;
    const active = this.rows().filter((r) => r.target !== 'stay' && r.target !== '');
    this.busy.set(true);
    this.error.set('');
    this.studentService
      .promote({
        moves: active.map((r) => ({ fromBatchId: r.batch.id, toBatchId: r.target === 'leave' ? null : r.target })),
        keepBackStudentIds: active.flatMap((r) => r.students.filter((st) => !r.moving.has(st.id)).map((st) => st.id)),
      })
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.result.set(res);
        },
        error: (e) => {
          this.busy.set(false);
          this.error.set(errorMessage(e));
        },
      });
  }

  private patch(batchId: string, change: Partial<Row>): void {
    this.rows.update((rows) => rows.map((r) => (r.batch.id === batchId ? { ...r, ...change } : r)));
    this.error.set('');
  }

  private load(): void {
    forkJoin([this.batchService.list(), this.studentService.list()]).subscribe(([batches, students]) => {
      this.batches.set(batches);
      this.rows.set(
        batches.map((b) => {
          const list = students.filter((s) => s.batchId === b.id);
          const { target, missingNext } = this.suggest(b, batches);
          return { batch: b, students: list, target, moving: new Set(list.map((s) => s.id)), open: false, missingNext };
        }),
      );
      this.loading.set(false);
    });
  }

  /** Schools: next class, same section (Class 12 leaves). Coaching: everyone stays unless you choose. */
  private suggest(b: Batch, all: Batch[]): { target: Target; missingNext: Row['missingNext'] } {
    if (!b.className) return { target: 'stay', missingNext: null };
    const i = SCHOOL_CLASSES.indexOf(b.className);
    if (i === SCHOOL_CLASSES.length - 1) return { target: 'leave', missingNext: null };
    const next = SCHOOL_CLASSES[i + 1]!;
    const exact = all.find((x) => x.className === next && x.section === b.section);
    if (exact) return { target: exact.id, missingNext: null };
    const any = all.find((x) => x.className === next);
    if (any) return { target: any.id, missingNext: null };
    return { target: '', missingNext: { className: next, section: b.section } };
  }
}
