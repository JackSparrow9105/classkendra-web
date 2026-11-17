import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Holiday } from '../models/models';
import { ApiService } from './api.service';

/**
 * Holidays for the whole centre (schools and coaching, every plan).
 * On a holiday no absent alerts go to parents, fee reminders wait for the next working day,
 * and staff are not marked absent.
 */
@Injectable({ providedIn: 'root' })
export class HolidayService {
  private readonly api = inject(ApiService);

  /** GET /holidays — from 30 days ago to a year ahead, oldest first. */
  list(): Observable<Holiday[]> {
    return this.api.get<Holiday[]>('holidays');
  }

  /** POST /holidays — owner. `to` empty = one day. */
  add(name: string, from: string, to: string): Observable<Holiday> {
    return this.api.post<Holiday>('holidays', { name, from, to: to || from });
  }

  /** DELETE /holidays/{id} — owner. */
  remove(id: string): Observable<void> {
    return this.api.delete<void>(`holidays/${id}`);
  }
}
