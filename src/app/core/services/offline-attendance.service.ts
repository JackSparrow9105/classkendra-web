import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ToastService } from '../../shared/toast';

const KEY = 'ck-attendance-outbox';

/** A register saved on this phone that hasn't reached the server yet. */
export interface QueuedRegister {
  batchId: string;
  batchName: string;
  date: string;
  absentStudentIds: string[];
  /** When Save was pressed (UTC ISO). The API refuses it if someone else saved the register after this. */
  clientSavedAt: string;
  /** Who saved it: only that person's phone session sends it. */
  userId: string;
}

/**
 * Attendance that works without internet. When a register can't be sent (no connection, or the server
 * doesn't answer) it is kept on this phone and sent automatically when the connection is back:
 * on the "online" event, when the app opens, and every 30 seconds while something is waiting.
 * Registers are sent one by one, oldest first. Saving the same register again replaces the waiting copy.
 * Payments and staff check-in are never queued: those must happen online.
 */
@Injectable({ providedIn: 'root' })
export class OfflineAttendanceService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  private readonly items = signal<QueuedRegister[]>(this.read());
  /** Registers waiting to be sent by the signed-in person. */
  readonly waiting = computed(() => this.items().filter((i) => i.userId === this.auth.user()?.id));
  readonly count = computed(() => this.waiting().length);
  readonly sending = signal(false);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.sync());
      setInterval(() => {
        if (this.count() > 0 && navigator.onLine) this.sync();
      }, 30_000);
      setTimeout(() => this.sync(), 3_000);
    }
  }

  /** The waiting copy of one register, if there is one (the attendance screen shows it instead of the server's). */
  find(batchId: string, date: string): QueuedRegister | undefined {
    return this.waiting().find((i) => i.batchId === batchId && i.date === date);
  }

  add(r: Omit<QueuedRegister, 'userId' | 'clientSavedAt'>): void {
    const userId = this.auth.user()?.id;
    if (!userId) return;
    const item: QueuedRegister = { ...r, userId, clientSavedAt: new Date().toISOString() };
    this.items.update((list) => [...list.filter((i) => !(i.batchId === r.batchId && i.date === r.date && i.userId === userId)), item]);
    this.write();
  }

  /** True when this error means "couldn't reach the server" (keep it for later), not "the server said no". */
  static isOffline(e: unknown): boolean {
    return e instanceof HttpErrorResponse ? e.status === 0 || e.status >= 500 : true;
  }

  /** Sends what is waiting, oldest first. Stops at the first connection problem and tries again later. */
  sync(): void {
    if (environment.useMock || this.sending() || this.count() === 0 || !this.auth.token()) return;
    const next = [...this.waiting()].sort((a, b) => a.clientSavedAt.localeCompare(b.clientSavedAt))[0]!;
    this.sending.set(true);
    this.api
      .post<{ alerted: number }>(`attendance/${next.batchId}`, {
        date: next.date,
        absentStudentIds: next.absentStudentIds,
        clientSavedAt: next.clientSavedAt,
      })
      .subscribe({
        next: (res) => {
          this.remove(next);
          this.sending.set(false);
          const alerted = res.alerted ? ` ${res.alerted} parents alerted.` : '';
          this.toast.show(`Attendance for ${next.batchName} (${next.date.slice(8)}/${next.date.slice(5, 7)}) sent.${alerted}`);
          this.sync();
        },
        error: (e: unknown) => {
          this.sending.set(false);
          if (OfflineAttendanceService.isOffline(e)) return; // still offline: try again later
          // The server refused it (someone saved after this, or the class/date isn't allowed): drop it and say why.
          this.remove(next);
          const msg = e instanceof HttpErrorResponse && e.error?.message ? e.error.message : 'It could not be saved.';
          this.toast.show(`Attendance for ${next.batchName} not sent: ${msg}`);
          this.sync();
        },
      });
  }

  private remove(r: QueuedRegister): void {
    this.items.update((list) => list.filter((i) => i !== r && !(i.batchId === r.batchId && i.date === r.date && i.userId === r.userId && i.clientSavedAt === r.clientSavedAt)));
    this.write();
  }

  private read(): QueuedRegister[] {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as QueuedRegister[]) : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items()));
    } catch {
      /* storage full or blocked: the register stays in memory until the app closes */
    }
  }
}
