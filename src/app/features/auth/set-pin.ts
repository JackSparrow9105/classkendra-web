import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { I18nService, TPipe } from '../../core/i18n/i18n.service';
import { AuthService, pinProblem } from '../../core/services/auth.service';
import { CentreService } from '../../core/services/centre.service';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';
import { continueAfterLogin } from './after-login';

/**
 * Choose the 4-digit app PIN: after the first OTP login on a phone, after "Forgot PIN?",
 * or from Settings (?change=1). Owners and office staff must set one; teachers can skip.
 */
@Component({
  selector: 'app-set-pin',
  imports: [ReactiveFormsModule, RouterLink, Icon, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './set-pin.html',
  styleUrls: ['./auth.scss', './pin.scss'],
})
export class SetPin {
  protected readonly auth = inject(AuthService);
  private readonly centre = inject(CentreService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly changing = inject(ActivatedRoute).snapshot.queryParamMap.get('change') === '1';
  protected readonly step = signal<'enter' | 'confirm'>('enter');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly pin = new FormControl('', { nonNullable: true });
  private first = '';

  /** Teachers may skip (unless they came here from "Forgot PIN?"). */
  protected readonly canSkip = computed(() => !this.changing && !this.auth.mustSetPin());
  protected readonly dots = computed(() => [0, 1, 2, 3]);
  protected readonly filled = signal(0);

  protected onInput(): void {
    const digits = this.pin.value.replace(/\D/g, '').slice(0, 4);
    if (digits !== this.pin.value) this.pin.setValue(digits);
    this.filled.set(digits.length);
    this.error.set('');
    if (digits.length === 4) this.next(digits);
  }

  private next(digits: string): void {
    if (this.step() === 'enter') {
      const problem = pinProblem(digits);
      if (problem) {
        this.fail(problem);
        return;
      }
      this.first = digits;
      this.step.set('confirm');
      this.clear();
      return;
    }
    if (digits !== this.first) {
      this.step.set('enter');
      this.first = '';
      this.fail("The PINs didn't match. Please choose your PIN again.");
      return;
    }
    this.save(digits);
  }

  private save(pin: string): void {
    this.busy.set(true);
    this.auth.setPin(pin).subscribe({
      next: () => {
        this.toast.show(
          this.i18n.t(
            this.changing ? 'PIN changed' : 'PIN set. Use it next time you open the app.',
          ),
        );
        if (this.changing) this.router.navigateByUrl('/settings');
        else continueAfterLogin(this.router, this.auth, this.centre);
      },
      error: (e) => {
        this.busy.set(false);
        this.step.set('enter');
        this.first = '';
        this.fail(errorMessage(e));
      },
    });
  }

  protected skip(): void {
    this.auth.skipPin();
    continueAfterLogin(this.router, this.auth, this.centre);
  }

  private fail(message: string): void {
    this.error.set(message);
    this.clear();
  }

  private clear(): void {
    this.pin.setValue('');
    this.filled.set(0);
  }
}
