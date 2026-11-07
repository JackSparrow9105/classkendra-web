import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, from, map, switchMap, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { AuthResponse, AuthUser } from '../models/models';
import { ApiService } from './api.service';
import { FirebasePhoneService } from './firebase-phone.service';
import { I18nService } from '../i18n/i18n.service';

const TOKEN_KEY = 'ck-token';
const USER_KEY = 'ck-user';
/** Remembers this phone/browser after an OTP login. With it (and the PIN) the user can unlock without OTP. */
const DEVICE_KEY = 'ck-device';
/** Set by "Forgot PIN?": after the OTP the user must choose a new PIN. */
const PIN_RESET_KEY = 'ck-pin-reset';
/** Teachers who tapped "Skip for now" on the PIN screen (per user id) aren't asked again. */
const PIN_SKIP_KEY = 'ck-pin-skipped';

/** What happened when the PIN was entered. */
export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; message: string; attemptsLeft: number }
  | { ok: false; reason: 'locked' | 'signed-out' | 'error'; message: string };

/**
 * Login state.
 *  - logged in: we hold a token (and usually a device key).
 *  - locked:    no token, but a device key and a user with a PIN → show the PIN screen (/unlock).
 *  - signed out: nothing → /login (mobile + OTP).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);
  private readonly firebase = inject(FirebasePhoneService);
  private readonly i18n = inject(I18nService);

  readonly user = signal<AuthUser | null>(this.read<AuthUser>(USER_KEY));
  readonly token = signal<string | null>(this.read<string>(TOKEN_KEY));
  readonly device = signal<string | null>(this.read<string>(DEVICE_KEY));
  readonly isLoggedIn = computed(() => !!this.token());
  readonly isLocked = computed(() => !this.token() && !!this.device() && !!this.user()?.hasPin);
  readonly hasCentre = computed(() => !!this.user()?.tenantId);
  readonly role = computed(() => this.user()?.role ?? 'Owner');
  readonly isTeacher = computed(() => this.role() === 'Teacher');
  readonly isOwner = computed(() => this.role() === 'Owner');
  readonly hasPin = computed(() => !!this.user()?.hasPin);
  /** Owner and office staff must have a PIN (older saved logins don't carry the flag yet). */
  readonly pinRequired = computed(() => this.user()?.pinRequired ?? this.role() !== 'Teacher');
  /** "Forgot PIN?" was used: a new PIN must be chosen after the OTP. */
  private readonly pinReset = signal(this.read<boolean>(PIN_RESET_KEY) === true);
  /** Logged in but must set a PIN before using the app. */
  readonly mustSetPin = computed(
    () => this.isLoggedIn() && (this.pinReset() || (!this.hasPin() && this.pinRequired())),
  );
  /** Phone number carried from the login screen to the OTP screen. */
  readonly pendingPhone = signal('');

  /** POST /auth/otp  { phone } */
  requestOtp(phone: string): Observable<void> {
    this.pendingPhone.set(phone);
    if (environment.useMock) return this.mock.respond(undefined, 500);
    // SMS through Firebase: the code is sent from the browser, not by our API.
    if (environment.otpProvider === 'firebase')
      return from(this.firebase.send(phone, this.i18n.lang()));
    return this.api.post<void>('auth/otp', { phone });
  }

  /** POST /auth/verify  { phone, code } -> { token, user, deviceToken } */
  verifyOtp(phone: string, code: string): Observable<AuthResponse> {
    const call$ = environment.useMock
      ? this.mockVerify(phone, code)
      : environment.otpProvider === 'firebase'
        ? // Firebase checks the code, then our API checks Firebase's proof: POST /auth/firebase { idToken }
          from(this.firebase.confirm(code)).pipe(
            switchMap((idToken) => this.api.post<AuthResponse>('auth/firebase', { idToken })),
          )
        : this.api.post<AuthResponse>('auth/verify', { phone, code });
    return call$.pipe(tap((res) => this.setSession(res)));
  }

  /** Should the PIN screen be shown right after an OTP login? (Teachers can skip it once.) */
  shouldAskForPin(): boolean {
    const u = this.user();
    if (!u) return false;
    if (this.mustSetPin()) return true;
    if (u.hasPin) return false;
    const skipped = this.read<string[]>(PIN_SKIP_KEY) ?? [];
    return !skipped.includes(u.id);
  }

  /** "Skip for now" on the PIN screen (teachers only). */
  skipPin(): void {
    const u = this.user();
    if (!u) return;
    const skipped = this.read<string[]>(PIN_SKIP_KEY) ?? [];
    if (!skipped.includes(u.id)) this.write(PIN_SKIP_KEY, [...skipped, u.id]);
  }

  /** POST /auth/pin { pin, deviceToken } -> { token, user, deviceToken? } — set or change the PIN. */
  setPin(pin: string): Observable<AuthResponse> {
    const call$ = environment.useMock
      ? this.mockSetPin(pin)
      : this.api.post<AuthResponse>('auth/pin', { pin, deviceToken: this.device() });
    return call$.pipe(
      tap((res) => {
        this.setSession(res);
        this.remove(PIN_RESET_KEY);
        this.pinReset.set(false);
      }),
    );
  }

  /** DELETE /auth/pin — teachers only. */
  removePin(): Observable<AuthUser> {
    const call$ = environment.useMock
      ? this.mockRemovePin()
      : this.api.delete<AuthUser>('auth/pin');
    return call$.pipe(tap((u) => this.saveUser({ ...this.user()!, ...u })));
  }

  /** POST /auth/unlock { deviceToken, pin } — the PIN screen. Never throws; tells the screen what to show. */
  unlock(pin: string): Observable<UnlockResult> {
    const call$ = environment.useMock
      ? this.mockUnlock(pin)
      : this.api.post<AuthResponse>('auth/unlock', { deviceToken: this.device(), pin });
    return new Observable<UnlockResult>((sub) => {
      const s = call$.subscribe({
        next: (res) => {
          this.setSession(res);
          sub.next({ ok: true });
          sub.complete();
        },
        error: (e: unknown) => {
          const status = e instanceof HttpErrorResponse ? e.status : 0;
          const body =
            e instanceof HttpErrorResponse && typeof e.error === 'object' ? (e.error ?? {}) : {};
          const message: string = body.message ?? 'Something went wrong. Please try again.';
          if (status === 400 && typeof body.attemptsLeft === 'number') {
            sub.next({ ok: false, reason: 'wrong', message, attemptsLeft: body.attemptsLeft });
          } else if (status === 423) {
            sub.next({ ok: false, reason: 'locked', message });
          } else if (status === 401 || status === 409) {
            this.pendingPhone.set(this.user()?.phone ?? '');
            this.clearAll();
            sub.next({ ok: false, reason: 'signed-out', message });
          } else {
            sub.next({ ok: false, reason: 'error', message });
          }
          sub.complete();
        },
      });
      return () => s.unsubscribe();
    });
  }

  /**
   * POST /auth/refresh { deviceToken } — renews the login of users without a PIN so they stay logged in
   * while they keep using the app. Users with a PIN renew by unlocking.
   */
  refresh(): Observable<void> {
    if (!this.device() || this.hasPin()) return from(Promise.resolve());
    const call$ = environment.useMock
      ? this.mockRefresh()
      : this.api.post<AuthResponse>('auth/refresh', { deviceToken: this.device() });
    return call$.pipe(
      tap((res) => this.setSession(res)),
      map(() => undefined),
    );
  }

  /** GET /auth/me — picks up role, batches and PIN changes made elsewhere. */
  reloadUser(): Observable<AuthUser> {
    const call$ = environment.useMock ? this.mockMe() : this.api.get<AuthUser>('auth/me');
    return call$.pipe(tap((u) => this.saveUser(u)));
  }

  /** After time away: keep who it is and the device key, drop the token → PIN screen. */
  lock(): void {
    this.token.set(null);
    this.remove(TOKEN_KEY);
    if (environment.useMock) this.mock.update((s) => (s.token = null));
  }

  /** "Forgot PIN?" or a locked PIN: forget this device, log in with OTP, then choose a new PIN. */
  startPinReset(): void {
    this.pendingPhone.set(this.user()?.phone ?? '');
    this.write(PIN_RESET_KEY, true);
    this.pinReset.set(true);
    this.forgetDevice();
    this.clearAll();
  }

  /** Called after the centre is created so guards know setup step 1 is done. */
  setTenant(tenantId: string, ownerName: string): void {
    const u = this.user();
    if (!u) return;
    this.saveUser({ ...u, tenantId, name: ownerName || u.name });
  }

  logout(): void {
    this.forgetDevice();
    this.remove(PIN_RESET_KEY);
    this.pinReset.set(false);
    this.clearAll();
  }

  /** Seconds until our token expires (null if unknown, e.g. demo tokens). */
  tokenSecondsLeft(): number | null {
    const t = this.token();
    const part = t?.split('.')[1];
    if (!part) return null;
    try {
      const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      return typeof json.exp === 'number' ? json.exp - Date.now() / 1000 : null;
    } catch {
      return null;
    }
  }

  // ---------------- Storage ----------------

  /** Tells the server to forget this device (fire and forget). */
  private forgetDevice(): void {
    const key = this.device();
    if (!key) return;
    if (environment.useMock) this.mock.update((s) => s.devices && delete s.devices[key]);
    else
      this.api
        .post<void>('auth/logout', { deviceToken: key })
        .subscribe({ error: () => undefined });
  }

  private clearAll(): void {
    this.token.set(null);
    this.user.set(null);
    this.device.set(null);
    this.remove(TOKEN_KEY);
    this.remove(USER_KEY);
    this.remove(DEVICE_KEY);
    // The mock keeps the owner record so the owner can sign back in to the same centre.
    if (environment.useMock) this.mock.update((s) => (s.token = null));
  }

  private setSession(res: AuthResponse): void {
    this.token.set(res.token);
    this.write(TOKEN_KEY, res.token);
    // Just logged in or unlocked: the 10-minute "away" timer starts again (see LockService).
    this.write('ck-last-active', Date.now());
    if (res.deviceToken) {
      this.device.set(res.deviceToken);
      this.write(DEVICE_KEY, res.deviceToken);
    }
    this.saveUser(res.user);
  }

  private saveUser(u: AuthUser): void {
    this.user.set(u);
    this.write(USER_KEY, u);
    if (environment.useMock && u.role === 'Owner') this.mock.update((s) => (s.user = u));
  }

  private read<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  // ---------------- Demo mode (same rules as the API) ----------------

  private mockUser(id: string): AuthUser | null {
    const s = this.mock.snapshot;
    const member = s.staff.find((m) => m.id === id);
    const base: AuthUser | null = member
      ? {
          id: member.id,
          phone: member.phone,
          name: member.name,
          role: member.role,
          tenantId: s.centre?.id ?? null,
          batchIds: member.batchIds,
        }
      : s.user?.id === id
        ? s.user
        : null;
    if (!base) return null;
    return { ...base, hasPin: !!s.pins?.[id], pinRequired: base.role !== 'Teacher' };
  }

  private mockFail(status: number, error: Record<string, unknown>): Observable<never> {
    return new Observable((sub) => {
      setTimeout(() => sub.error(new HttpErrorResponse({ status, error })), 300);
    });
  }

  private mockVerify(phone: string, code: string): Observable<AuthResponse> {
    if (code !== '123456')
      return this.mock.fail('That code is not right. In demo mode use 123456.');
    const s = this.mock.snapshot;
    // A staff member or teacher added by the owner signs in with their own number and lands in the same centre.
    const member = s.staff.find((m) => m.phone === phone);
    const base: AuthUser = member
      ? {
          id: member.id,
          phone,
          name: member.name,
          role: member.role,
          tenantId: s.centre?.id ?? null,
          batchIds: member.batchIds,
        }
      : s.user?.phone === phone && s.user.role === 'Owner'
        ? s.user
        : {
            id: this.mock.id('usr'),
            phone,
            name: '',
            role: 'Owner',
            tenantId: s.centre?.id ?? null,
            batchIds: [],
          };
    const deviceToken = this.mock.id('dev');
    this.mock.update((st) => {
      st.token = 'mock-jwt-' + base.id;
      if (base.role === 'Owner') st.user = base;
      st.devices = { ...(st.devices ?? {}), [deviceToken]: base.id };
      if (st.pins?.[base.id]) st.pins[base.id]!.attempts = 0; // OTP also unlocks a locked PIN
    });
    const user = this.mockUser(base.id) ?? {
      ...base,
      hasPin: false,
      pinRequired: base.role !== 'Teacher',
    };
    return this.mock.respond({ token: 'mock-jwt-' + base.id, user, deviceToken }, 600);
  }

  private mockSetPin(pin: string): Observable<AuthResponse> {
    const problem = pinProblem(pin);
    if (problem) return this.mockFail(400, { message: problem });
    const id = this.user()?.id;
    if (!id) return this.mockFail(401, { message: 'Please sign in again.' });
    let deviceToken: string | null = null;
    this.mock.update((s) => {
      s.pins = { ...(s.pins ?? {}), [id]: { pin, attempts: 0 } };
      const key = this.device();
      if (!key || s.devices?.[key] !== id) {
        deviceToken = this.mock.id('dev');
        s.devices = { ...(s.devices ?? {}), [deviceToken]: id };
      }
    });
    return this.mock.respond(
      { token: 'mock-jwt-' + id, user: this.mockUser(id)!, deviceToken },
      300,
    );
  }

  private mockRemovePin(): Observable<AuthUser> {
    const id = this.user()?.id ?? '';
    if (this.pinRequired())
      return this.mockFail(400, {
        message: 'Owners and office staff need a PIN because the app shows fees.',
      });
    this.mock.update((s) => s.pins && delete s.pins[id]);
    return this.mock.respond(this.mockUser(id)!, 200);
  }

  private mockUnlock(pin: string): Observable<AuthResponse> {
    const s = this.mock.snapshot;
    const id = s.devices?.[this.device() ?? ''];
    const user = id ? this.mockUser(id) : null;
    if (!id || !user)
      return this.mockFail(401, { message: 'Please log in with your mobile number again.' });
    const entry = s.pins?.[id];
    if (!entry) return this.mockFail(409, { message: "You haven't set a PIN yet.", noPin: true });
    const lockedMsg = 'Your PIN is locked after 5 wrong tries. Log in with OTP to unlock it.';
    if (entry.attempts >= 5) return this.mockFail(423, { message: lockedMsg, locked: true });
    if (entry.pin !== pin) {
      const attempts = entry.attempts + 1;
      this.mock.update((st) => (st.pins![id]!.attempts = attempts));
      const left = 5 - attempts;
      return left <= 0
        ? this.mockFail(423, { message: lockedMsg, locked: true })
        : this.mockFail(400, {
            message: left === 1 ? 'Wrong PIN. 1 try left.' : `Wrong PIN. ${left} tries left.`,
            attemptsLeft: left,
          });
    }
    this.mock.update((st) => {
      st.pins![id]!.attempts = 0;
      st.token = 'mock-jwt-' + id;
    });
    return this.mock.respond({ token: 'mock-jwt-' + id, user, deviceToken: null }, 300);
  }

  private mockRefresh(): Observable<AuthResponse> {
    const id = this.mock.snapshot.devices?.[this.device() ?? ''];
    const user = id ? this.mockUser(id) : null;
    if (!id || !user)
      return this.mockFail(401, { message: 'Please log in with your mobile number again.' });
    if (user.hasPin) return this.mockFail(409, { message: 'Enter your PIN.', pinRequired: true });
    return this.mock.respond({ token: 'mock-jwt-' + id, user, deviceToken: null }, 150);
  }

  private mockMe(): Observable<AuthUser> {
    const u = this.mockUser(this.user()?.id ?? '');
    return u ? this.mock.respond(u, 100) : this.mockFail(401, { message: 'Please sign in again.' });
  }
}

/** Same rules as PinService.CheckNewPin in the API. Null if fine. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'Enter 4 digits.';
  if (new Set(pin).size === 1) return "Choose a PIN that isn't the same digit 4 times.";
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin))
    return "Choose a PIN that isn't 1234 or 4321 style.";
  return null;
}
