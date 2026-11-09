import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { CentreService } from '../../core/services/centre.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { Icon } from '../../shared/icon';
import { TPipe } from '../../core/i18n/i18n.service';
import { continueAfterLogin } from './after-login';

@Component({
  selector: 'app-otp',
  imports: [ReactiveFormsModule, RouterLink, Icon, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './otp.html',
  styleUrl: './auth.scss',
})
export class Otp {
  private readonly auth = inject(AuthService);
  private readonly centre = inject(CentreService);
  private readonly router = inject(Router);

  protected readonly phone = this.auth.pendingPhone();
  protected readonly isDemo = environment.useMock;
  protected readonly code = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^\d{6}$/)],
  });
  protected readonly form = new FormGroup({ code: this.code });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly secondsLeft = signal(30);
  /** 'email': the number isn't working, so the code went to the backup email instead. */
  protected readonly mode = signal<'phone' | 'email'>('phone');
  /** Where the email code went, partly hidden ("a•••@gmail.com"). */
  protected readonly sentTo = signal('');
  protected readonly emailBusy = signal(false);

  constructor() {
    if (!this.phone) {
      this.router.navigateByUrl('/login');
      return;
    }
    const timer = setInterval(() => this.secondsLeft.update((s) => Math.max(0, s - 1)), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected onInput(): void {
    const digits = this.code.value.replace(/\D/g, '').slice(0, 6);
    if (digits !== this.code.value) this.code.setValue(digits);
    this.error.set('');
    if (digits.length === 6) this.verify();
  }

  protected verify(): void {
    if (this.code.invalid) {
      this.error.set('Enter the 6-digit code.');
      return;
    }
    if (this.busy()) return;
    this.busy.set(true);
    const login$ =
      this.mode() === 'email'
        ? this.auth.verifyEmailLogin(this.phone, this.code.value)
        : this.auth.verifyOtp(this.phone, this.code.value);
    login$.subscribe({
      next: () => {
        // First login on this phone: choose the app PIN (required for owner and staff).
        if (this.auth.shouldAskForPin()) this.router.navigateByUrl('/set-pin');
        else continueAfterLogin(this.router, this.auth, this.centre);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.busy.set(false);
        this.code.setValue('');
      },
    });
  }

  protected resend(): void {
    if (this.mode() === 'email') {
      this.useEmail();
      return;
    }
    this.auth.requestOtp(this.phone).subscribe(() => this.secondsLeft.set(30));
  }

  /** "Number not working?" — send the login code to the backup email instead. */
  protected useEmail(): void {
    if (this.emailBusy()) return;
    this.emailBusy.set(true);
    this.error.set('');
    this.auth.requestEmailLogin(this.phone).subscribe({
      next: (r) => {
        this.sentTo.set(r.sentTo);
        this.mode.set('email');
        this.code.setValue('');
        this.secondsLeft.set(60);
        this.emailBusy.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.emailBusy.set(false);
      },
    });
  }

  /** Back to the code on the phone. */
  protected usePhone(): void {
    this.mode.set('phone');
    this.code.setValue('');
    this.error.set('');
  }
}
