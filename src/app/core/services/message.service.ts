import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import { MessageLog, MessageStatus, MessageSummary, MessageType } from '../models/models';
import { ApiService } from './api.service';

export interface MessageFilter {
  type?: MessageType | '';
  status?: MessageStatus | '';
  studentId?: string;
  search?: string;
}

const STATUSES: MessageStatus[] = ['Queued', 'Sent', 'Delivered', 'Read', 'Failed'];

@Injectable({ providedIn: 'root' })
export class MessageService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);

  /** GET /messages?type=&status=&studentId=&search=  (the API should paginate) */
  list(filter: MessageFilter = {}): Observable<MessageLog[]> {
    if (!environment.useMock) return this.api.get<MessageLog[]>('messages', { ...filter });
    this.simulateDelivery();
    const q = (filter.search ?? '').trim().toLowerCase();
    const rows = this.mock.snapshot.messages
      .filter((m) => !filter.type || m.type === filter.type)
      .filter((m) => !filter.status || m.status === filter.status)
      .filter((m) => !filter.studentId || m.studentId === filter.studentId)
      .filter((m) => !q || m.recipientName.toLowerCase().includes(q) || m.phone.includes(q) || m.text.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return this.mock.respond(rows.slice(0, 200), 200);
  }

  /** GET /messages/summary?days=30 */
  summary(): Observable<MessageSummary> {
    if (!environment.useMock) return this.api.get<MessageSummary>('messages/summary');
    this.simulateDelivery();
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<MessageStatus, number>;
    for (const m of this.mock.snapshot.messages) byStatus[m.status]++;
    return this.mock.respond({ total: this.mock.snapshot.messages.length, byStatus }, 100);
  }

  /** POST /messages/{id}/retry — puts a failed message back in the outbox. */
  retry(id: string): Observable<MessageLog> {
    if (!environment.useMock) return this.api.post<MessageLog>(`messages/${id}/retry`);
    let row!: MessageLog;
    this.mock.update((s) => {
      row = s.messages.find((m) => m.id === id)!;
      const now = new Date().toISOString();
      Object.assign(row, { status: 'Queued', error: null, createdAt: now, updatedAt: now });
    });
    return this.mock.respond(row);
  }

  /**
   * Demo only: moves messages along Queued → Sent → Delivered → Read over a few seconds,
   * with about 1 in 11 failing, the way the WhatsApp provider's status webhook would.
   */
  private simulateDelivery(): void {
    const now = Date.now();
    this.mock.update((s) => {
      for (const m of s.messages) {
        if (m.status === 'Failed' || m.status === 'Read') continue;
        const age = (now - Date.parse(m.createdAt)) / 1000;
        const h = hash(m.id + m.createdAt);
        let next: MessageStatus = m.status;
        if (h % 11 === 0 && age > 4) next = 'Failed';
        else if (age > 40 && h % 3 === 0) next = 'Read';
        else if (age > 10) next = 'Delivered';
        else if (age > 3) next = 'Sent';
        if (next !== m.status) {
          m.status = next;
          m.updatedAt = new Date().toISOString();
          m.error = next === 'Failed' ? 'This number is not on WhatsApp' : null;
        }
      }
    });
  }
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}
