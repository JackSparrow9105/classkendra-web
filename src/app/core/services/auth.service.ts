import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { AuthResponse, AuthUser } from '../models/models';
import { ApiService } from './api.service';

const TOKEN_KEY = 'ck-token';
const USER_KEY = 'ck-user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  readonly user = signal<AuthUser | null>(this.read<AuthUser>(USER_KEY));
  readonly token = signal<string | null>(this.read<string>(TOKEN_KEY));
  readonly isLoggedIn = computed(() => !!this.token());
  readonly hasCentre = computed(() => !!this.user()?.tenantId);
  readonly role = computed(() => this.user()?.role ?? 'Owner');
  readonly isTeacher = computed(() => this.role() === 'Teacher');
  readonly isOwner = computed(() => this.role() === 'Owner');
  /** Phone number carried from the login screen to the OTP screen. */
  readonly pendingPhone = signal('');

  /** POST /auth/otp  { phone } */
  requestOtp(phone: string): Observable<void> {
    this.pendingPhone.set(phone);
    if (environment.useMock) return this.mock.respond(undefined, 500);
    return this.api.post<void>('auth/otp', { phone });
  }

  /** POST /auth/verify  { phone, code } -> { token, user } */
  verifyOtp(phone: string, code: string): Observable<AuthResponse> {
    const call$ = environment.useMock
      ? this.mockVerify(phone, code)
      : this.api.post<AuthResponse>('auth/verify', { phone, code });
    return call$.pipe(tap((res) => this.setSession(res)));
  }

  /** Called after the centre is created so guards know setup step 1 is done. */
  setTenant(tenantId: string, ownerName: string): void {
    const u = this.user();
    if (!u) return;
    this.saveUser({ ...u, tenantId, name: ownerName || u.name });
  }

  logout(): void {
    this.token.set(null);
    this.user.set(null);
    this.remove(TOKEN_KEY);
    this.remove(USER_KEY);
    // The mock keeps the owner record so the owner can sign back in to the same centre.
    if (environment.useMock) this.mock.update((s) => (s.token = null));
  }

  private mockVerify(phone: string, code: string): Observable<AuthResponse> {
    if (code !== '123456') return this.mock.fail('That code is not right. In demo mode use 123456.');
    const s = this.mock.snapshot;
    // A staff member or teacher added by the owner signs in with their own number and lands in the same centre.
    const member = s.staff.find((m) => m.phone === phone);
    const user: AuthUser = member
      ? { id: member.id, phone, name: member.name, role: member.role, tenantId: s.centre?.id ?? null, batchIds: member.batchIds }
      : s.user?.phone === phone && s.user.role === 'Owner'
        ? s.user
        : { id: this.mock.id('usr'), phone, name: '', role: 'Owner', tenantId: s.centre?.id ?? null, batchIds: [] };
    const res: AuthResponse = { token: 'mock-jwt-' + user.id, user };
    this.mock.update((st) => {
      st.token = res.token;
      if (user.role === 'Owner') st.user = user;
    });
    return this.mock.respond(res, 600);
  }

  private setSession(res: AuthResponse): void {
    this.token.set(res.token);
    this.write(TOKEN_KEY, res.token);
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
}
