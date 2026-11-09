import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { CentreService } from '../../core/services/centre.service';

const RETURN_KEY = 'ck-return-url';

/** Remember the page the user was on when the app locked, to go back there after the PIN. */
export function rememberReturnUrl(url: string): void {
  if (!url || /^\/(login|otp|unlock|set-pin)/.test(url)) return;
  try {
    sessionStorage.setItem(RETURN_KEY, url);
  } catch {
    /* ignore */
  }
}

/** After OTP, PIN or unlock: back to where they were, or the right start page (setup, Home or dashboard). */
export function continueAfterLogin(router: Router, auth: AuthService, centre: CentreService): void {
  let back: string | null = null;
  try {
    back = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    /* ignore */
  }
  if (back) {
    router.navigateByUrl(back);
    return;
  }
  if (!auth.user()?.tenantId) {
    router.navigateByUrl('/setup/centre');
    return;
  }
  centre
    .load()
    .subscribe((c) =>
      router.navigateByUrl(
        auth.isTeacher() ? '/home' : c?.setupComplete ? '/dashboard' : '/setup/batches',
      ),
    );
}
