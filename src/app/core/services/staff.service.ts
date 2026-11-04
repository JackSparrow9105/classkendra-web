import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { StaffMember } from '../models/models';
import { ApiService } from './api.service';

export type StaffInput = Omit<StaffMember, 'id'>;

/**
 * Office staff and teachers. They sign in with their own mobile number + OTP;
 * the API links that number to this centre and gives them their role.
 */
@Injectable({ providedIn: 'root' })
export class StaffService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  /** GET /staff */
  list(): Observable<StaffMember[]> {
    if (!environment.useMock) return this.api.get<StaffMember[]>('staff');
    return this.mock.respond([...this.mock.snapshot.staff].sort((a, b) => a.name.localeCompare(b.name)), 150);
  }

  /** POST /staff — the API sends them a WhatsApp invite with the app link. */
  create(input: StaffInput): Observable<StaffMember> {
    if (!environment.useMock) return this.api.post<StaffMember>('staff', input);
    const s = this.mock.snapshot;
    if (s.staff.some((m) => m.phone === input.phone) || s.user?.phone === input.phone) {
      return this.mock.fail('Someone with this number is already added.');
    }
    const member: StaffMember = { id: this.mock.id('stf'), ...input };
    this.mock.update((st) => st.staff.push(member));
    return this.mock.respond(member);
  }

  /** PUT /staff/{id} */
  update(id: string, input: StaffInput): Observable<StaffMember> {
    if (!environment.useMock) return this.api.put<StaffMember>(`staff/${id}`, input);
    const member: StaffMember = { id, ...input };
    this.mock.update((s) => (s.staff = s.staff.map((m) => (m.id === id ? member : m))));
    return this.mock.respond(member);
  }

  /** DELETE /staff/{id} — they can no longer sign in. */
  remove(id: string): Observable<void> {
    if (!environment.useMock) return this.api.delete<void>(`staff/${id}`);
    this.mock.update((s) => (s.staff = s.staff.filter((m) => m.id !== id)));
    return this.mock.respond(undefined);
  }
}
