import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { Centre, Lang } from '../models/models';
import { daysBetween, isoDate } from '../../shared/format';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export type CentreInput = Pick<Centre, 'name' | 'ownerName' | 'city' | 'subjects' | 'sizeBand' | 'institutionType'> &
  Partial<Pick<Centre, 'address' | 'phone'>>;

/** Address of a logo image (no login needed, so it works in <img>). */
export function logoUrl(logoId: string | null | undefined): string | null {
  return logoId ? `${environment.apiUrl}/centre/logo/${logoId}` : null;
}

@Injectable({ providedIn: 'root' })
export class CentreService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);
  private readonly auth = inject(AuthService);

  /** Cached centre for the header, trial badge and message previews. */
  readonly centre = signal<Centre | null>(null);
  readonly trialDaysLeft = computed(() => {
    const c = this.centre();
    return c?.plan === 'Trial' ? Math.max(0, daysBetween(isoDate(), c.trialEndsOn)) : null;
  });

  /** GET /centre */
  load(): Observable<Centre | null> {
    const call$ = environment.useMock
      ? this.mock.respond(this.mock.snapshot.centre, 150)
      : this.api.get<Centre | null>('centre');
    return call$.pipe(tap((c) => this.centre.set(c)));
  }

  /** POST /centre (first time) or PUT /centre */
  save(input: CentreInput): Observable<Centre> {
    const call$ = environment.useMock
      ? this.mockSave(input)
      : this.centre()
        ? this.api.put<Centre>('centre', input)
        : this.api.post<Centre>('centre', input);
    return call$.pipe(
      tap((c) => {
        this.centre.set(c);
        this.auth.setTenant(c.id, c.ownerName);
      }),
    );
  }

  /** PUT /centre/setup-complete */
  completeSetup(): Observable<Centre> {
    const call$ = environment.useMock
      ? (this.mock.update((s) => s.centre && (s.centre.setupComplete = true)),
        this.mock.respond(this.mock.snapshot.centre!))
      : this.api.put<Centre>('centre/setup-complete', {});
    return call$.pipe(tap((c) => this.centre.set(c)));
  }

  /** PUT /centre/message-language  { language } — which approved WhatsApp templates parents get. */
  setMessageLanguage(language: Lang): Observable<Centre> {
    const call$ = environment.useMock
      ? (this.mock.update((s) => s.centre && (s.centre.messageLanguage = language)), this.mock.respond(this.mock.snapshot.centre!))
      : this.api.put<Centre>('centre/message-language', { language });
    return call$.pipe(tap((c) => this.centre.set(c)));
  }

  /** POST /centre/logo (multipart "file") — becomes the logo on new receipts. */
  uploadLogo(image: Blob): Observable<Centre> {
    if (environment.useMock) return this.mock.fail('Logo upload needs the live API.');
    const form = new FormData();
    form.append('file', image, 'logo');
    return this.api.post<Centre>('centre/logo', form).pipe(tap((c) => this.centre.set(c)));
  }

  /** DELETE /centre/logo — new receipts have no logo; old receipts keep theirs. */
  removeLogo(): Observable<Centre> {
    const call$ = environment.useMock
      ? (this.mock.update((s) => s.centre && (s.centre.logoId = null)), this.mock.respond(this.mock.snapshot.centre!))
      : this.api.delete<Centre>('centre/logo');
    return call$.pipe(tap((c) => this.centre.set(c)));
  }

  private mockSave(input: CentreInput): Observable<Centre> {
    const existing = this.mock.snapshot.centre;
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 30);
    const centre: Centre = existing
      ? { ...existing, ...input }
      : {
          id: this.mock.id('ten'),
          ...input,
          plan: 'Trial',
          trialEndsOn: isoDate(trialEnd),
          messagesUsed: 0,
          messageLimit: 500,
          setupComplete: false,
          messageLanguage: 'en',
        };
    this.mock.update((s) => (s.centre = centre));
    return this.mock.respond(centre);
  }
}
