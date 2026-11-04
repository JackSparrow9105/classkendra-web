import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Batch } from '../../core/models/models';
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

  /** 'manage' when opened from Settings, otherwise it's onboarding step 2. */
  readonly mode = input<string>();
  protected readonly manage = computed(() => this.mode() === 'manage');

  protected readonly dayOptions = ['Mon–Sat', 'Mon–Fri', 'Mon, Wed, Fri', 'Tue, Thu, Sat', 'Sat–Sun', 'Every day'];
  protected readonly batches = signal<Batch[]>([]);
  protected readonly loading = signal(true);
  protected readonly editing = signal<Batch | 'new' | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly submitted = signal(false);
  protected readonly formatTime = formatTime;

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    days: new FormControl('Mon–Sat', { nonNullable: true }),
    startTime: new FormControl('16:00', { nonNullable: true, validators: [Validators.required] }),
    endTime: new FormControl('17:00', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    this.reload();
  }

  protected open(b: Batch | 'new'): void {
    this.error.set('');
    this.submitted.set(false);
    if (b === 'new') {
      this.form.reset({ name: '', days: 'Mon–Sat', startTime: '16:00', endTime: '17:00' });
    } else {
      this.form.reset({ name: b.name, days: b.days, startTime: b.startTime, endTime: b.endTime });
    }
    this.editing.set(b);
  }

  protected save(): void {
    this.submitted.set(true);
    const v = this.form.getRawValue();
    if (this.form.invalid) return;
    if (v.endTime <= v.startTime) {
      this.error.set('End time must be after start time.');
      return;
    }
    const current = this.editing();
    const fee = current && current !== 'new' ? current.monthlyFee : null;
    const call$ = current && current !== 'new'
      ? this.batchService.update(current.id, { ...v, monthlyFee: fee })
      : this.batchService.create({ ...v, monthlyFee: null });
    this.busy.set(true);
    call$.subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set(null);
        this.reload();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected remove(): void {
    const current = this.editing();
    if (!current || current === 'new') return;
    this.batchService.remove(current.id).subscribe({
      next: () => {
        this.editing.set(null);
        this.toast.show('Batch removed');
        this.reload();
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected finish(): void {
    this.busy.set(true);
    this.centre.completeSetup().subscribe(() => this.router.navigateByUrl('/dashboard'));
  }

  private reload(): void {
    this.batchService.list().subscribe((list) => {
      this.batches.set(list);
      this.loading.set(false);
    });
  }
}
