import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { InstitutionType } from '../../core/models/models';
import { LABELS } from '../../core/labels';
import { CentreService } from '../../core/services/centre.service';
import { AuthService } from '../../core/services/auth.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { Icon, IconName } from '../../shared/icon';

@Component({
  selector: 'app-setup-centre',
  imports: [ReactiveFormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './setup-centre.html',
  styleUrl: './setup.scss',
})
export class SetupCentre {
  private readonly centreService = inject(CentreService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly types: { id: InstitutionType; icon: IconName; title: string; sub: string }[] = [
    { id: 'Coaching', icon: 'cap', title: 'Coaching or tuition centre', sub: 'Batches, monthly fees' },
    { id: 'School', icon: 'home', title: 'School', sub: 'Classes and sections, fee heads' },
  ];
  protected readonly subjectOptions = ['School tuition', 'JEE / NEET', 'Competitive exams', 'Computer courses', 'Spoken English', 'Other'];

  protected readonly type = signal<InstitutionType>('Coaching');
  protected readonly l = computed(() => LABELS[this.type()]);
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    ownerName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
  });
  protected readonly subjects = signal<string[]>(['School tuition']);
  protected readonly size = signal(LABELS.Coaching.defaultSize);
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    this.centreService.load().subscribe((c) => {
      if (!c) return;
      this.form.patchValue({ name: c.name, ownerName: c.ownerName, city: c.city });
      this.type.set(c.institutionType);
      this.subjects.set(c.subjects);
      this.size.set(c.sizeBand);
    });
  }

  protected pickType(t: InstitutionType): void {
    if (t === this.type()) return;
    this.type.set(t);
    this.size.set(LABELS[t].defaultSize);
  }

  protected toggleSubject(s: string): void {
    this.subjects.update((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));
  }

  protected invalid(name: 'name' | 'ownerName'): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid) return;
    this.busy.set(true);
    this.centreService
      .save({
        ...this.form.getRawValue(),
        institutionType: this.type(),
        subjects: this.type() === 'Coaching' ? this.subjects() : [],
        sizeBand: this.size(),
      })
      .subscribe({
        next: () => this.router.navigateByUrl('/setup/batches'),
        error: (e) => {
          this.error.set(errorMessage(e));
          this.busy.set(false);
        },
      });
  }

  protected signOut(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
