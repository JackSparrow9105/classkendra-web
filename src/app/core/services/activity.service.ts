import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ActivityAction, ActivityEntry, Paged } from '../models/models';
import { ApiService } from './api.service';

/** The activity log: who cancelled a payment, marked a student as left, waived fees… and why. Owner only. */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly api = inject(ApiService);

  /** GET /activity?action=&search=&page=&pageSize= — newest first. */
  page(filter: { action?: ActivityAction | ''; search?: string; page?: number; pageSize?: number } = {}): Observable<Paged<ActivityEntry>> {
    return this.api.get<Paged<ActivityEntry>>('activity', filter);
  }
}
