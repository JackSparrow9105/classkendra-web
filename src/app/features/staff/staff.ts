import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Batch, StaffMember } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { AuthService } from '../../core/services/auth.service';
import { BatchService } from '../../core/services/batch.service';
import { CentreService } from '../../core/services/centre.service';
import { StaffService } from '../../core/services/staff.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { initials } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

type Role = StaffMember['role'];

@Component({
  selector: 'app-staff',
  imports: [ReactiveFormsModule, RouterLink, Icon, BottomSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './staff.html',
  styleUrl: './staff.scss',
})
export class Staff {
  private readonly staffService = inject(StaffService);
  private readonly batchService = inject(BatchService);
  private readonly toast = inject(ToastService);
  protected readonly labels = inject(LabelService);
  protected readonly auth = inject(AuthService);
  protected readonly centre = inject(CentreService);

  protected readonly members = signal<StaffMember[]>([]);
  protected readonly batches = signal<Batch[]>([]);
  protected readonly editing = signal<StaffMember | 'new' | null>(null);
  protected readonly role = signal<Role>('Teacher');
  protected readonly picked = signal<string[]>([]);
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly initials = initials;

  private readonly batchNames = computed(() => new Map(this.batches().map((b) => [b.id, b.name])));

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)] }),
  });

  constructor() {
    this.reload();
  }

  protected groupsOf(m: StaffMember): string {
    if (m.role === 'Staff') return `All ${this.labels.l().groupsLower}, fees and students`;
    const names = m.batchIds.map((id) => this.batchNames().get(id)).filter(Boolean);
    return names.length ? names.join(', ') : `No ${this.labels.l().groupsLower} yet`;
  }

  protected open(m: StaffMember | 'new'): void {
    this.error.set('');
    this.submitted.set(false);
    if (m === 'new') {
      this.form.reset({ name: '', phone: '' });
      this.role.set('Teacher');
      this.picked.set([]);
    } else {
      this.form.reset({ name: m.name, phone: m.phone });
      this.role.set(m.role);
      this.picked.set([...m.batchIds]);
    }
    this.editing.set(m);
  }

  protected togglePick(id: string): void {
    this.picked.update((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  protected onPhoneInput(): void {
    const c = this.form.controls.phone;
    const digits = c.value.replace(/\D/g, '').slice(-10);
    if (digits !== c.value) c.setValue(digits);
  }

  protected save(): void {
    this.submitted.set(true);
    this.error.set('');
    if (this.form.invalid) return;
    if (this.role() === 'Teacher' && this.picked().length === 0) {
      this.error.set(`Pick at least one ${this.labels.l().groupLower} for this teacher.`);
      return;
    }
    const input = {
      ...this.form.getRawValue(),
      role: this.role(),
      batchIds: this.role() === 'Teacher' ? this.picked() : [],
    };
    const current = this.editing();
    const call$ = current && current !== 'new' ? this.staffService.update(current.id, input) : this.staffService.create(input);
    this.busy.set(true);
    call$.subscribe({
      next: (m) => {
        this.busy.set(false);
        this.editing.set(null);
        this.toast.show(current === 'new' ? `${m.name} added. They can sign in with their number.` : 'Changes saved');
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
    if (!current || current === 'new' || !confirm(`Remove ${current.name}? They won't be able to sign in.`)) return;
    this.staffService.remove(current.id).subscribe(() => {
      this.editing.set(null);
      this.toast.show(`${current.name} removed`);
      this.reload();
    });
  }

  private reload(): void {
    forkJoin([this.staffService.list(), this.batchService.list()]).subscribe(([members, batches]) => {
      this.members.set(members);
      this.batches.set(batches);
    });
  }
}
