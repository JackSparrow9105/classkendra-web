import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CentreService } from '../../core/services/centre.service';
import { AuthService } from '../../core/services/auth.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';

@Component({
  selector: 'app-setup-centre',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './setup-centre.html',
  styleUrl: './setup.scss',
})
export class SetupCentre {
  private readonly centreService = inject(CentreService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly subjectOptions = ['School tuition', 'JEE / NEET', 'Competitive exams', 'Computer courses', 'Spoken English', 'Other'];
  protected readonly sizeOptions = ['Under 50', '50–150', '150–300', '300+'];

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    ownerName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
  });
  protected readonly subjects = signal<string[]>(['School tuition']);
  protected readonly size = signal('50–150');
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    this.centreService.load().subscribe((c) => {
      if (!c) return;
      this.form.patchValue({ name: c.name, ownerName: c.ownerName, city: c.city });
      this.subjects.set(c.subjects);
      this.size.set(c.sizeBand);
    });
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
      .save({ ...this.form.getRawValue(), subjects: this.subjects(), sizeBand: this.size() })
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
