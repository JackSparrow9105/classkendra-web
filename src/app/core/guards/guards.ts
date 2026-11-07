import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Where a signed-in user starts. */
function homeUrl(auth: AuthService): string {
  return !auth.hasCentre() ? '/setup/centre' : auth.isTeacher() ? '/home' : '/dashboard';
}

/** Not signed in: the PIN screen if this phone is remembered and locked, otherwise mobile + OTP. */
function signedOutUrl(auth: AuthService): string {
  return auth.isLocked() ? '/unlock' : '/login';
}

/** Must be signed in (and owners/staff must have set their PIN). */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isLoggedIn()) return router.parseUrl(signedOutUrl(auth));
  return auth.mustSetPin() ? router.parseUrl('/set-pin') : true;
};

/** Signed-in users skip the login screens; a locked phone goes to the PIN screen. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.isLoggedIn()) return inject(Router).parseUrl(homeUrl(auth));
  return auth.isLocked() ? inject(Router).parseUrl('/unlock') : true;
};

/** The main app needs a centre; new owners are sent to setup first. */
export const centreGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isLoggedIn()) return router.parseUrl(signedOutUrl(auth));
  if (auth.mustSetPin()) return router.parseUrl('/set-pin');
  return auth.hasCentre() ? true : router.parseUrl('/setup/centre');
};

/** The PIN screen: only when the app is locked. */
export const lockedGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.isLocked()) return true;
  return inject(Router).parseUrl(auth.isLoggedIn() ? homeUrl(auth) : '/login');
};

/** Choosing a PIN needs a signed-in user. */
export const signedInGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).parseUrl(signedOutUrl(auth));
};

/** Owner-only pages (billing, staff). Others are sent to their home screen. */
export const ownerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.isOwner()) return true;
  return inject(Router).parseUrl(auth.isTeacher() ? '/home' : '/dashboard');
};

/** Money and setup pages are for the owner and office staff. Teachers only mark attendance and see their students. */
export const officeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isTeacher() ? inject(Router).parseUrl('/home') : true;
};

/** The teacher's Home. Owner and office staff have the full dashboard instead. */
export const teacherGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isTeacher() ? true : inject(Router).parseUrl('/dashboard');
};
