import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { concat, of } from 'rxjs';
import { catchError, toArray } from 'rxjs/operators';
import { Batch } from '../../core/models/models';
import { LabelService, SCHOOL_CLASSES, SECTIONS, schoolGroupName } from '../../core/labels';
import { BatchService } from '../../core/services/batch.service';
import { CentreService } from '../../core/services/centre.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';
import { formatTime } from './time';

@Component({
  selector: 'app-setup-batches',
  imports: [ReactiveFormsModule, RouterLink, Icon, BottomSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './setup-batches.html',
  styleUrl: './setup.scss',
})
export class SetupBatches {
  private readonly batchService = inject(BatchService);
  private readonly centre = inject(CentreService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly labels = inject(LabelService);

  /** 'manage' when opened from Settings, otherwise it's onboarding step 2. */
  readonly mode = input<string>();
  protected readonly manage = computed(() => this.mode() === 'manage');

  protected readonly dayOptions = ['Mon–Sat', 'Mon–Fri', 'Mon, Wed, Fri', 'Tue, Thu, Sat', 'Sat–Sun', 'Every day'];
  protected readonly classOptions = SCHOOL_CLASSES;
  protected readonly sectionOptions = SECTIONS;
  protected readonly classLabel = (c: string) => (/^\d+$/.test(c) ? `Class ${c}` : c);

  protected readonly batches = signal<Batch[]>([]);
  protected readonly loading = signal(true);
  protected readonly editing = signal<Batch | 'new' | null>(null);
  protected readonly sections = signal<string[]>(['A']);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly submitted = signal(false);
  protected readonly formatTime = formatTime;

  /** Coaching batch fields */
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    days: new FormControl('Mon–Sat', { nonNullable: true }),
    startTime: new FormControl('16:00', { nonNullable: true }),
    endTime: new FormControl('17:00', { nonNullable: true }),
    className: new FormControl('1', { nonNullable: true }),
  });

  constructor() {
    if (!this.centre.centre()) this.centre.load().subscribe();
    this.reload();
  }

  protected open(b: Batch | 'new'): void {
    this.error.set('');
    this.submitted.set(false);
    if (b === 'new') {
      this.form.reset({ name: '', days: 'Mon–Sat', startTime: '16:00', endTime: '17:00', className: this.nextClass() });
      this.sections.set(['A']);
    } else {
      this.form.reset({
        name: b.name,
        days: b.days ?? 'Mon–Sat',
        startTime: b.startTime ?? '16:00',
        endTime: b.endTime ?? '17:00',
        className: b.className ?? '1',
      });
      this.sections.set(b.section ? [b.section] : []);
    }
    this.editing.set(b);
  }

  protected toggleSection(s: string): void {
    const editingExisting = this.editing() !== 'new';
    this.sections.update((list) =>
      editingExisting ? [s] : list.includes(s) ? list.filter((x) => x !== s) : [...list, s].sort(),
    );
  }

  protected save(): void {
    this.submitted.set(true);
    this.error.set('');
    const current = this.editing();
    if (!current) return;
    if (this.labels.isSchool()) this.saveSchool(current);
    else this.saveCoaching(current);
  }

  protected remove(): void {
    const current = this.editing();
    if (!current || current === 'new') return;
    this.batchService.remove(current.id).subscribe({
      next: () => {
        this.editing.set(null);
        this.toast.show(`${current.name} removed`);
        this.reload();
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected finish(): void {
    this.busy.set(true);
    this.centre.completeSetup().subscribe(() => this.router.navigateByUrl('/dashboard'));
  }

  private saveCoaching(current: Batch | 'new'): void {
    const v = this.form.getRawValue();
    if (!v.name.trim()) return;
    if (v.endTime <= v.startTime) {
      this.error.set('End time must be after start time.');
      return;
    }
    const input = { name: v.name.trim(), className: null, section: null, days: v.days, startTime: v.startTime, endTime: v.endTime };
    const call$ = current === 'new' ? this.batchService.create(input) : this.batchService.update(current.id, input);
    this.run(call$, () => this.editing.set(null));
  }

  /** A new class with several sections becomes one group per section ("Class 8 · A", "Class 8 · B"). */
  private saveSchool(current: Batch | 'new'): void {
    const className = this.form.controls.className.value;
    const sections = this.sections();
    const make = (section: string | null) => ({
      name: schoolGroupName(className, section),
      className,
      section,
      days: null,
      startTime: null,
      endTime: null,
    });

    if (current !== 'new') {
      this.run(this.batchService.update(current.id, make(sections[0] ?? null)), () => this.editing.set(null));
      return;
    }
    const list = sections.length ? sections : [null];
    const calls = list.map((sec) =>
      this.batchService.create(make(sec)).pipe(catchError((e: unknown) => of(errorMessage(e)))),
    );
    this.busy.set(true);
    concat(...calls).pipe(toArray()).subscribe((results) => {
      this.busy.set(false);
      const failed = results.filter((r): r is string => typeof r === 'string');
      if (failed.length) this.error.set(failed.join(' '));
      if (failed.length < results.length) {
        this.reload();
        if (!failed.length) this.editing.set(null);
      }
    });
  }

  private run(call$: ReturnType<BatchService['create']>, done: () => void): void {
    this.busy.set(true);
    call$.subscribe({
      next: () => {
        this.busy.set(false);
        done();
        this.reload();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  /** Suggest the class after the last one added. */
  private nextClass(): string {
    const used = this.batches().map((b) => b.className).filter((c): c is string => !!c);
    const last = used.length ? Math.max(...used.map((c) => SCHOOL_CLASSES.indexOf(c))) : -1;
    return SCHOOL_CLASSES[Math.min(last + 1, SCHOOL_CLASSES.length - 1)] ?? '1';
  }

  private reload(): void {
    this.batchService.list().subscribe((list) => {
      this.batches.set(list);
      this.loading.set(false);
    });
  }
}
