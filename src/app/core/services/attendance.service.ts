import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { AttendanceSheet } from '../models/models';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  /** GET /attendance/{batchId}?date= */
  get(batchId: string, date: string): Observable<AttendanceSheet> {
    if (!environment.useMock) return this.api.get<AttendanceSheet>(`attendance/${batchId}`, { date });
    const saved = this.mock.snapshot.attendance[`${batchId}|${date}`];
    return this.mock.respond({ batchId, date, absentStudentIds: saved ?? [], saved: !!saved }, 150);
  }

  /**
   * POST /attendance/{batchId}  { date, absentStudentIds }
   * The API saves the sheet and adds one absent-alert row per absent student to the Notifications outbox.
   * Saving again on the same day only alerts newly absent students.
   */
  save(batchId: string, date: string, absentStudentIds: string[]): Observable<{ alerted: number }> {
    if (!environment.useMock) {
      return this.api.post<{ alerted: number }>(`attendance/${batchId}`, { date, absentStudentIds });
    }
    const key = `${batchId}|${date}`;
    const before = this.mock.snapshot.attendance[key] ?? [];
    const alerted = absentStudentIds.filter((id) => !before.includes(id)).length;
    this.mock.update((s) => {
      s.attendance[key] = [...absentStudentIds];
      if (s.centre) s.centre.messagesUsed += alerted;
    });
    return this.mock.respond({ alerted }, 400);
  }
}
