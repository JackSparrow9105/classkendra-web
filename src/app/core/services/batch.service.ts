import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { Batch } from '../models/models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export type BatchInput = Omit<Batch, 'id'>;

/** Batches (coaching) and class-sections (school) share this service and the /batches endpoints. */
@Injectable({ providedIn: 'root' })
export class BatchService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);
  private readonly auth = inject(AuthService);

  /** GET /batches — the API returns only a teacher's own classes when a teacher calls it. */
  list(): Observable<Batch[]> {
    if (!environment.useMock) return this.api.get<Batch[]>('batches');
    const user = this.auth.user();
    const rows = this.mock.snapshot.batches
      .filter((b) => user?.role !== 'Teacher' || user.batchIds.includes(b.id))
      .sort(byClassThenName);
    return this.mock.respond(rows, 150);
  }

  /** POST /batches  (schools: one call per section) */
  create(input: BatchInput): Observable<Batch> {
    if (!environment.useMock) return this.api.post<Batch>('batches', input);
    if (this.mock.snapshot.batches.some((b) => b.name.toLowerCase() === input.name.toLowerCase())) {
      return this.mock.fail(`${input.name} already exists.`);
    }
    const batch: Batch = { id: this.mock.id('bat'), ...input };
    this.mock.update((s) => s.batches.push(batch));
    return this.mock.respond(batch);
  }

  /** PUT /batches/{id} */
  update(id: string, input: BatchInput): Observable<Batch> {
    if (!environment.useMock) return this.api.put<Batch>(`batches/${id}`, input);
    const batch: Batch = { id, ...input };
    this.mock.update((s) => (s.batches = s.batches.map((b) => (b.id === id ? batch : b))));
    return this.mock.respond(batch);
  }

  /** DELETE /batches/{id} — the API should refuse if students are still in it. */
  remove(id: string): Observable<void> {
    if (!environment.useMock) return this.api.delete<void>(`batches/${id}`);
    if (this.mock.snapshot.students.some((s) => s.batchId === id && s.active)) {
      return this.mock.fail('Move the students out first, then delete it.');
    }
    this.mock.update((s) => {
      s.batches = s.batches.filter((b) => b.id !== id);
      for (const h of s.heads) delete h.amounts[id];
      s.staff.forEach((m) => (m.batchIds = m.batchIds.filter((b) => b !== id)));
    });
    return this.mock.respond(undefined);
  }
}

const CLASS_ORDER = ['Nursery', 'LKG', 'UKG'];

/** School classes sort Nursery, LKG, UKG, 1…12 then by section; coaching batches by name. */
function byClassThenName(a: Batch, b: Batch): number {
  if (a.className && b.className) {
    const rank = (c: string) => (CLASS_ORDER.includes(c) ? CLASS_ORDER.indexOf(c) - 10 : Number(c));
    return rank(a.className) - rank(b.className) || (a.section ?? '').localeCompare(b.section ?? '');
  }
  return a.name.localeCompare(b.name);
}
