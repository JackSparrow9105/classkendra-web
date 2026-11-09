import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { TPipe } from '../../core/i18n/i18n.service';
import { BottomSheet } from '../../shared/bottom-sheet';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

type Step = 'view' | 'enter' | 'code';

/**
 * Settings → Backup email. A second way to get the login code if the mobile number stops working.
 * Add: email (+ app PIN) → code sent to that email → type it → saved. Change/remove from the same sheet.
 */
@Component({
  selector: 'app-backup-email',
  imports: [ReactiveFormsModule, BottomSheet, Icon, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './backup-email.html',
  styleUrl: './backup-email.scss',
})
export class BackupEmail {
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly open = signal(false);
  protected readonly step = signal<Step>('enter');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** The address the code was just sent to. */
  protected readonly pendingEmail = signal('');

  protected readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email, Validators.maxLength(254)],
  });
  protected readonly pin = new FormControl('', { nonNullable: true });
  protected readonly code = new FormControl('', { nonNullable: true });

  protected show(): void {
    this.error.set('');
    this.step.set(this.auth.user()?.email ? 'view' : 'enter');
    this.open.set(true);
  }

  protected startChange(): void {
    this.email.reset(this.pendingEmail() || '');
    this.pin.reset('');
    this.error.set('');
    this.step.set('enter');
  }

  protected onPinInput(): void {
    const digits = this.pin.value.replace(/\D/g, '').slice(0, 4);
    if (digits !== this.pin.value) this.pin.setValue(digits);
  }

  protected onCodeInput(): void {
    const digits = this.code.value.replace(/\D/g, '').slice(0, 6);
    if (digits !== this.code.value) this.code.setValue(digits);
    this.error.set('');
    if (digits.length === 6) this.verify();
  }

  protected send(): void {
    const email = this.email.value.trim();
    if (this.email.invalid || !email.includes('.')) {
      this.error.set('Enter a valid email address, e.g. name@gmail.com.');
      return;
    }
    if (this.auth.hasPin() && this.pin.value.length !== 4) {
      this.error.set('Enter your 4-digit app PIN.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.auth.startBackupEmail(email, this.auth.hasPin() ? this.pin.value : null).subscribe({
      next: (r) => {
        this.pendingEmail.set(r.sentTo);
        this.code.reset('');
        this.step.set('code');
        this.busy.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.pin.reset('');
        this.busy.set(false);
      },
    });
  }

  protected verify(): void {
    if (this.busy()) return;
    if (!/^\d{6}$/.test(this.code.value)) {
      this.error.set('Enter the 6-digit code.');
      return;
    }
    this.busy.set(true);
    this.auth.verifyBackupEmail(this.code.value, this.pendingEmail()).subscribe({
      next: () => {
        this.busy.set(false);
        this.open.set(false);
        this.toast.show('Backup email saved');
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.code.reset('');
        this.busy.set(false);
      },
    });
  }

  protected remove(): void {
    if (!confirm('Remove your backup email? If your mobile number stops working, you will need support to get back in.')) return;
    this.busy.set(true);
    this.auth.removeBackupEmail().subscribe({
      next: () => {
        this.busy.set(false);
        this.open.set(false);
        this.toast.show('Backup email removed');
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.busy.set(false);
      },
    });
  }
}
