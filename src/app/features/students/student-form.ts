import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Batch } from '../../core/models/models';
import { BatchService } from '../../core/services/batch.service';
import { StudentService } from '../../core/services/student.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { isoDate } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

/** Contact Picker API (Chrome on Android). Not available everywhere, so the button only shows when supported. */
interface ContactsManager {
  select(props: string[], opts?: { multiple: boolean }): Promise<{ name?: string[]; tel?: string[] }[]>;
}

@Component({
  selector: 'app-student-form',
  imports: [ReactiveFormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './student-form.html',
  styleUrl: './students.scss',
})
export class StudentForm {
  private readonly students = inject(StudentService);
  private readonly batchService = inject(BatchService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** Route param; undefined on /students/new. */
  readonly id = input<string>();
  protected readonly isEdit = computed(() => !!this.id());

  protected readonly batches = signal<Batch[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly submitted = signal(false);
  protected readonly addedCount = signal(0);
  protected readonly canPickContact =
    typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    parentName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    parentPhone: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)] }),
    batchId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    joinedOn: new FormControl(isoDate(), { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    this.batchService.list().subscribe((list) => {
      this.batches.set(list);
      if (!this.form.controls.batchId.value && list.length === 1) this.form.patchValue({ batchId: list[0]!.id });
    });

    effect(() => {
      const id = this.id();
      if (!id) return;
      this.students.get(id).subscribe((s) => {
        if (!s) {
          this.router.navigateByUrl('/students');
          return;
        }
        this.form.patchValue(s);
      });
    });
  }

  protected invalid(name: keyof typeof this.form.controls): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected onPhoneInput(): void {
    const c = this.form.controls.parentPhone;
    const digits = c.value.replace(/\D/g, '').slice(-10);
    if (digits !== c.value) c.setValue(digits);
  }

  protected async pickContact(): Promise<void> {
    try {
      const mgr = (navigator as unknown as { contacts: ContactsManager }).contacts;
      const [contact] = await mgr.select(['name', 'tel'], { multiple: false });
      if (!contact) return;
      const phone = (contact.tel?.[0] ?? '').replace(/\D/g, '').slice(-10);
      this.form.patchValue({ parentPhone: phone, parentName: this.form.value.parentName || contact.name?.[0] || '' });
    } catch {
      /* user cancelled */
    }
  }

  protected save(addAnother: boolean): void {
    this.submitted.set(true);
    this.error.set('');
    if (this.form.invalid) return;
    this.busy.set(true);
    const value = this.form.getRawValue();
    const id = this.id();
    const call$ = id ? this.students.update(id, value) : this.students.create(value);
    call$.subscribe({
      next: (s) => {
        this.busy.set(false);
        if (addAnother) {
          this.addedCount.update((n) => n + 1);
          this.toast.show(`${s.name} added`);
          this.submitted.set(false);
          // Keep batch and date: the next student is usually from the same batch.
          this.form.reset({ ...value, name: '', parentName: '', parentPhone: '' });
          document.getElementById('s-name')?.focus();
        } else {
          this.toast.show(id ? 'Changes saved' : `${s.name} added`);
          this.router.navigateByUrl('/students');
        }
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected deactivate(): void {
    const id = this.id();
    if (!id || !confirm('Remove this student? Their paid fee history is kept.')) return;
    this.students.deactivate(id).subscribe(() => {
      this.toast.show('Student removed');
      this.router.navigateByUrl('/students');
    });
  }
}
