import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { Batch } from '../models/models';
import { ApiService } from './api.service';

export type BatchInput = Omit<Batch, 'id'>;

@Injectable({ providedIn: 'root' })
export class BatchService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  /** GET /batches */
  list(): Observable<Batch[]> {
    if (!environment.useMock) return this.api.get<Batch[]>('batches');
    return this.mock.respond(this.mock.snapshot.batches, 150);
  }

  /** POST /batches */
  create(input: BatchInput): Observable<Batch> {
    if (!environment.useMock) return this.api.post<Batch>('batches', input);
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

  /** DELETE /batches/{id} — the API should refuse if students are still in the batch. */
  remove(id: string): Observable<void> {
    if (!environment.useMock) return this.api.delete<void>(`batches/${id}`);
    if (this.mock.snapshot.students.some((s) => s.batchId === id && s.active)) {
      return this.mock.fail('Move the students out of this batch first.');
    }
    this.mock.update((s) => (s.batches = s.batches.filter((b) => b.id !== id)));
    return this.mock.respond(undefined);
  }
}
