import { Injectable } from '@angular/core';
import type { Auth, ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import { environment } from '../../../environments/environment';

/**
 * SMS login codes through Firebase Phone Auth.
 * Firebase sends the SMS and checks the code in the browser; we then hand Firebase's ID token to our API
 * (POST /auth/firebase), which checks it and signs the user in with our own token.
 * The Firebase SDK is only downloaded when this is used (environment.otpProvider === 'firebase').
 */
@Injectable({ providedIn: 'root' })
export class FirebasePhoneService {
  private auth: Auth | null = null;
  private verifier: RecaptchaVerifier | null = null;
  private pending: ConfirmationResult | null = null;

  /** Sends the 6-digit code by SMS to an Indian mobile ("9876543210"). */
  async send(phone: string, lang: string): Promise<void> {
    const auth = await this.getAuth();
    auth.languageCode = lang;
    const { signInWithPhoneNumber } = await import('firebase/auth');
    try {
      this.pending = await signInWithPhoneNumber(auth, `+91${phone}`, await this.getVerifier(auth));
    } catch (e) {
      // A failed send uses up the reCAPTCHA; make a fresh one for the next try.
      this.resetVerifier();
      throw friendly(e);
    }
  }

  /** Checks the code and returns Firebase's ID token for our API. */
  async confirm(code: string): Promise<string> {
    if (!this.pending) throw new Error('Please request a new code.');
    try {
      const cred = await this.pending.confirm(code);
      const token = await cred.user.getIdToken();
      this.pending = null;
      // We use our own login token from here on; Firebase's session isn't needed.
      void this.auth?.signOut();
      return token;
    } catch (e) {
      throw friendly(e);
    }
  }

  private async getAuth(): Promise<Auth> {
    if (this.auth) return this.auth;
    const cfg = environment.firebase;
    if (!cfg.apiKey || !cfg.projectId) throw new Error('SMS login is not set up yet (Firebase settings are empty).');
    const { initializeApp } = await import('firebase/app');
    const { getAuth } = await import('firebase/auth');
    this.auth = getAuth(initializeApp(cfg));
    return this.auth;
  }

  /** Invisible reCAPTCHA (Firebase uses it to stop bots). It needs an element on the page. */
  private async getVerifier(auth: Auth): Promise<RecaptchaVerifier> {
    if (this.verifier) return this.verifier;
    let el = document.getElementById('ck-recaptcha');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ck-recaptcha';
      document.body.appendChild(el);
    }
    const { RecaptchaVerifier } = await import('firebase/auth');
    this.verifier = new RecaptchaVerifier(auth, el, { size: 'invisible' });
    return this.verifier;
  }

  private resetVerifier(): void {
    this.verifier?.clear();
    this.verifier = null;
    document.getElementById('ck-recaptcha')?.remove();
  }
}

/** Firebase error codes → one sentence the user can act on. */
function friendly(e: unknown): Error {
  const code = (e as { code?: string })?.code ?? '';
  const messages: Record<string, string> = {
    'auth/invalid-verification-code': 'That code is not right.',
    'auth/code-expired': 'That code has expired. Please request a new one.',
    'auth/invalid-phone-number': 'Enter a valid 10-digit mobile number.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/quota-exceeded': "We can't send more codes right now. Please try again later.",
    'auth/captcha-check-failed': 'Security check failed. Please reload the page and try again.',
    'auth/network-request-failed': 'No internet connection. Please check and try again.',
    'auth/operation-not-allowed': 'SMS login is not switched on for this app yet.',
    'auth/unauthorized-domain': 'This website is not allowed to send login codes yet.',
    'auth/billing-not-enabled': 'SMS login is not switched on for this app yet.',
  };
  return new Error(messages[code] ?? (e instanceof Error && !code ? e.message : 'Something went wrong. Please try again.'));
}
