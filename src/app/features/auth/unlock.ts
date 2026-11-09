import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TPipe } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import { CentreService } from '../../core/services/centre.service';
import { initials } from '../../shared/format';
import { ToastService } from '../../shared/toast';
import { continueAfterLogin } from './after-login';

/** The PIN screen shown after 10 minutes away. 5 wrong PINs → log in with OTP again. */
@Component({
  selector: 'app-unlock',
  imports: [ReactiveFormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './unlock.html',
  styleUrls: ['./auth.scss', './pin.scss'],
})
export class Unlock {
  protected readonly auth = inject(AuthService);
  private readonly centre = inject(CentreService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly name = (this.auth.user()?.name || '').trim().split(/\s+/)[0] ?? '';
  protected readonly avatar = initials(this.auth.user()?.name || this.auth.user()?.phone || '?');
  protected readonly phoneTail = (this.auth.user()?.phone ?? '').slice(-4);
  protected readonly pin = new FormControl('', { nonNullable: true });
  protected readonly dots = [0, 1, 2, 3];
  protected readonly filled = signal(0);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly locked = signal(false);

  protected onInput(): void {
    const digits = this.pin.value.replace(/\D/g, '').slice(0, 4);
    if (digits !== this.pin.value) this.pin.setValue(digits);
    this.filled.set(digits.length);
    this.error.set('');
    if (digits.length === 4 && !this.busy()) this.check(digits);
  }

  private check(pin: string): void {
    this.busy.set(true);
    this.auth.unlock(pin).subscribe((r) => {
      this.busy.set(false);
      if (r.ok) {
        continueAfterLogin(this.router, this.auth, this.centre);
        return;
      }
      this.pin.setValue('');
      this.filled.set(0);
      if (r.reason === 'locked') this.locked.set(true);
      if (r.reason === 'signed-out') {
        this.toast.show(r.message);
        this.router.navigateByUrl('/login');
        return;
      }
      this.error.set(r.message);
    });
  }

  /** Locked after 5 tries: log in with OTP (the same PIN works again afterwards). */
  protected loginWithOtp(): void {
    const phone = this.auth.user()?.phone ?? '';
    this.auth.logout();
    this.auth.pendingPhone.set(phone);
    this.router.navigateByUrl('/login');
  }

  /** Forgot PIN: log in with OTP, then choose a new PIN. */
  protected forgot(): void {
    this.auth.startPinReset();
    this.router.navigateByUrl('/login');
  }

  /** Someone else's phone/account: sign out completely. */
  protected notMe(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
