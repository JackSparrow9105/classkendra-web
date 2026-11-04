import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
  styleUrl: './auth.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly phone = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)],
  });
  protected readonly form = new FormGroup({ phone: this.phone });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly submitted = signal(false);

  protected readonly benefits = [
    'Fee reminders go out on WhatsApp',
    'Attendance in a few taps',
    "See who has paid and who hasn't",
  ];

  protected onInput(): void {
    const digits = this.phone.value.replace(/\D/g, '').slice(0, 10);
    if (digits !== this.phone.value) this.phone.setValue(digits);
    this.error.set('');
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.phone.invalid) {
      this.error.set('Enter a 10-digit mobile number.');
      return;
    }
    this.busy.set(true);
    this.auth.requestOtp(this.phone.value).subscribe({
      next: () => this.router.navigateByUrl('/otp'),
      error: (e) => {
        this.error.set(errorMessage(e));
        this.busy.set(false);
      },
    });
  }
}
