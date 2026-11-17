import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Batch, FeeHead } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { BatchService } from '../../core/services/batch.service';
import { CentreService } from '../../core/services/centre.service';
import { FeeService } from '../../core/services/fee.service';
import { rupees } from '../../shared/format';
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
  private readonly fees = inject(FeeService);
  private readonly centre = inject(CentreService);
  protected readonly labels = inject(LabelService);
  protected readonly rupees = rupees;

  /** Optional fees (transport…) and the ones this student has opted into. */
  protected readonly optionalHeads = signal<FeeHead[]>([]);
  protected readonly optedIn = signal<string[]>([]);
  protected readonly batchIdValue = signal('');
  /** Edit: the batch the student was in when the page opened, and whether to charge the new batch's fee this month. */
  protected readonly savedBatch = signal('');
  protected readonly chargeNewBatch = signal(false);
  protected readonly batchChanged = computed(() => this.isEdit() && !!this.savedBatch() && this.batchIdValue() !== this.savedBatch());
  protected readonly availableOptional = computed(() =>
    this.optionalHeads().filter((h) => (h.amounts[this.batchIdValue()] ?? 0) > 0),
  );

  /** Route param; undefined on /students/new. */
  readonly id = input<string>();
  /** ?type=existing opens the form for a student who was already studying here. */
  readonly type = input<string>();
  protected readonly isEdit = computed(() => !!this.id());

  /**
   * New admission: admission number, admission fee and one-time fees, WhatsApp confirmation, admission screen.
   * Existing student: was already studying here — their register number, no admission fee, no message.
   */
  protected readonly kind = signal<'new' | 'existing'>('new');
  protected readonly isNew = computed(() => this.kind() === 'new');
  /** The centre's admission fee (Fees setup), and its amount for the chosen batch/class. */
  protected readonly admissionHead = signal<FeeHead | null>(null);
  protected readonly admissionFee = computed(() => this.admissionHead()?.amounts[this.batchIdValue()] ?? 0);
  protected readonly chargeAdmissionFee = signal(true);
  /** What the next automatic number looks like ("A-2026-0047" / "1251"), for the placeholder. */
  protected readonly nextNo = signal('');
  /** The number the student had when the form opened (edit). */
  protected readonly savedNo = signal('');

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
    admissionNo: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(20), Validators.pattern(/^[A-Za-z0-9\-\/. ]*$/)] }),
  });

  constructor() {
    this.form.controls.batchId.valueChanges.subscribe((v) => this.batchIdValue.set(v));
    this.fees.getSetup().subscribe((s) => {
      this.optionalHeads.set(s.heads.filter((h) => h.optional));
      this.admissionHead.set(s.heads.find((h) => h.admissionFee) ?? null);
    });
    this.centre.admissionNumbering().subscribe({ next: (n) => this.nextNo.set(n.example), error: () => undefined });
    effect(() => {
      if (!this.id()) this.kind.set(this.type() === 'existing' ? 'existing' : 'new');
    });
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
        this.form.patchValue({ ...s, admissionNo: s.admissionNo ?? '' });
        this.savedBatch.set(s.batchId);
        this.savedNo.set(s.admissionNo ?? '');
        this.kind.set(s.isNewAdmission ? 'new' : 'existing');
        this.optedIn.set(s.optionalHeadIds ?? []);
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

  protected setKind(k: 'new' | 'existing'): void {
    this.kind.set(k);
    // A new admission joins today; an existing student usually joined earlier — leave the date to them.
    if (k === 'new' && !this.isEdit()) this.form.patchValue({ joinedOn: isoDate() });
  }

  protected toggleOptional(id: string): void {
    this.optedIn.update((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  protected save(addAnother: boolean): void {
    this.submitted.set(true);
    this.error.set('');
    if (this.form.invalid) return;
    this.busy.set(true);
    const available = new Set(this.availableOptional().map((h) => h.id));
    const value = {
      ...this.form.getRawValue(),
      optionalHeadIds: this.optedIn().filter((id) => available.has(id)),
      isNewAdmission: this.isNew(),
      waiveAdmissionFee: this.isNew() && this.admissionFee() > 0 && !this.chargeAdmissionFee(),
      chargeNewBatchThisMonth: this.batchChanged() && this.chargeNewBatch(),
    };
    const id = this.id();
    const call$ = id ? this.students.update(id, value) : this.students.create(value);
    call$.subscribe({
      next: (s) => {
        this.busy.set(false);
        if (addAnother) {
          this.addedCount.update((n) => n + 1);
          this.toast.show(s.admissionNo ? `${s.name} added · ${s.admissionNo}` : `${s.name} added`);
          this.submitted.set(false);
          // Keep batch and date: the next student is usually from the same batch.
          this.form.reset({ ...this.form.getRawValue(), name: '', parentName: '', parentPhone: '', admissionNo: '' });
          this.optedIn.set([]);
          this.chargeAdmissionFee.set(true);
          this.centre.admissionNumbering().subscribe({ next: (n) => this.nextNo.set(n.example), error: () => undefined });
          document.getElementById('s-name')?.focus();
        } else {
          if (id) {
            this.toast.show('Changes saved');
            this.router.navigateByUrl(`/students/${id}`);
          } else if (s.isNewAdmission !== false) {
            this.router.navigate(['/students', s.id, 'admission'], { queryParams: { new: 1, sent: s.admissionMessageSent ? 1 : 0 } });
          } else {
            this.toast.show(s.admissionNo ? `${s.name} added · ${s.admissionNo}` : `${s.name} added`);
            this.router.navigateByUrl('/students');
          }
        }
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  /** Opens the "Mark as left" sheet on the student's page (last day, reason, what to do with pending fees). */
  protected deactivate(): void {
    const id = this.id();
    if (id) this.router.navigate(['/students', id], { queryParams: { leave: 1 } });
  }
}
