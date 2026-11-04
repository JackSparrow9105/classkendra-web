import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  AuthUser,
  Batch,
  Centre,
  FeeDue,
  FeeSettings,
  Student,
} from '../models/models';
import { isoDate, monthKey } from '../../shared/format';

/*
 * In-memory stand-in for the .NET API + SQL Server while the backend is being built.
 * State is kept in localStorage so a page refresh doesn't lose your test data.
 * Delete this folder once every service runs against the real API.
 */

export interface MockState {
  token: string | null;
  user: AuthUser | null;
  centre: Centre | null;
  batches: Batch[];
  students: Student[];
  dues: FeeDue[];
  feeSettings: FeeSettings | null;
  attendance: Record<string, string[]>;
}

const KEY = 'classkendra-mock-v1';

function empty(): MockState {
  return {
    token: null,
    user: null,
    centre: null,
    batches: [],
    students: [],
    dues: [],
    feeSettings: null,
    attendance: {},
  };
}

@Injectable({ providedIn: 'root' })
export class MockDb {
  private state: MockState = this.load();

  get snapshot(): MockState {
    return this.state;
  }

  update(mutator: (s: MockState) => void): void {
    mutator(this.state);
    this.save();
  }

  /** Simulates a network round trip and hands back a copy, like JSON over HTTP would. */
  respond<T>(value: T, ms = 250): Observable<T> {
    return of(structuredClone(value)).pipe(delay(ms));
  }

  fail(message: string): Observable<never> {
    return throwError(() => new Error(message));
  }

  id(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  reset(): void {
    const keepAuth = { token: this.state.token, user: this.state.user };
    this.state = { ...empty(), ...keepAuth };
    if (this.state.user) this.state.user.tenantId = null;
    this.save();
  }

  clearAll(): void {
    this.state = empty();
    this.save();
  }

  /** Creates dues for a month for every active student whose batch has a fee. Mirrors a Hangfire job. */
  ensureDues(month = monthKey()): void {
    const s = this.state;
    if (!s.feeSettings) return;
    const day = String(Math.min(s.feeSettings.dueDay, 28)).padStart(2, '0');
    let changed = false;
    for (const st of s.students.filter((x) => x.active)) {
      const batch = s.batches.find((b) => b.id === st.batchId);
      if (!batch?.monthlyFee) continue;
      if (s.dues.some((d) => d.studentId === st.id && d.month === month)) continue;
      s.dues.push({
        id: this.id('due'),
        studentId: st.id,
        batchId: batch.id,
        month,
        amount: batch.monthlyFee,
        dueDate: `${month}-${day}`,
        status: 'Pending',
        paidOn: null,
        paidAmount: null,
        mode: null,
        remindersSent: 0,
      });
      changed = true;
    }
    if (changed) this.save();
  }

  /** Fills the account with realistic sample data so every screen can be tried. */
  seedSample(): void {
    const s = this.state;
    const today = new Date();
    const thisMonth = monthKey(today);
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevMonth = monthKey(prev);

    s.batches = [
      { id: 'b_10m', name: 'Class 10 · Maths', days: 'Mon–Sat', startTime: '16:00', endTime: '17:00', monthlyFee: 2500 },
      { id: 'b_12p', name: 'Class 12 · Physics', days: 'Mon–Sat', startTime: '17:15', endTime: '18:30', monthlyFee: 3000 },
      { id: 'b_jee', name: 'JEE Batch A', days: 'Mon, Wed, Fri', startTime: '07:00', endTime: '09:00', monthlyFee: 4000 },
    ];
    const names: [string, string, string][] = [
      ['Aarav Gupta', 'Rajesh Gupta', 'b_10m'], ['Ananya Rao', 'Sunita Rao', 'b_10m'],
      ['Ishaan Mehta', 'Vikram Mehta', 'b_10m'], ['Kabir Joshi', 'Neeta Joshi', 'b_10m'],
      ['Meera Nair', 'Lakshmi Nair', 'b_10m'], ['Sara Khan', 'Imran Khan', 'b_10m'],
      ['Priya Singh', 'Amit Singh', 'b_12p'], ['Rohan Kumar', 'Suresh Kumar', 'b_12p'],
      ['Diya Sharma', 'Pooja Sharma', 'b_12p'], ['Arjun Patel', 'Ketan Patel', 'b_12p'],
      ['Tanvi Desai', 'Hema Desai', 'b_12p'], ['Neha Verma', 'Anil Verma', 'b_jee'],
      ['Vivaan Reddy', 'Kiran Reddy', 'b_jee'], ['Aditi Iyer', 'Ramesh Iyer', 'b_jee'],
      ['Kunal Bose', 'Arup Bose', 'b_jee'], ['Riya Malhotra', 'Sanjay Malhotra', 'b_jee'],
    ];
    s.students = names.map(([name, parent, batchId], i) => ({
      id: `s_${i + 1}`,
      name,
      parentName: parent,
      parentPhone: `98${String(10000000 + i * 734521).slice(0, 8)}`,
      batchId,
      joinedOn: isoDate(new Date(today.getFullYear(), today.getMonth() - 3, 1)),
      active: true,
    }));
    s.feeSettings = { dueDay: 5, remindBefore: true, remindOnDue: true, remindAfter: true };
    s.dues = [];
    this.ensureDues(prevMonth);
    this.ensureDues(thisMonth);

    // Most of last month is paid; two families are still late.
    for (const d of s.dues.filter((x) => x.month === prevMonth)) {
      if (d.studentId === 's_1' || d.studentId === 's_7') continue;
      Object.assign(d, { status: 'Paid', paidOn: `${prevMonth}-06`, paidAmount: d.amount, mode: 'UPI' });
    }
    // Around 60% of this month is paid so far.
    s.dues
      .filter((x) => x.month === thisMonth)
      .forEach((d, i) => {
        if (i % 5 < 3 && d.studentId !== 's_1') {
          Object.assign(d, { status: 'Paid', paidOn: isoDate(today), paidAmount: d.amount, mode: i % 2 ? 'Cash' : 'UPI' });
        }
      });
    this.save();
  }

  private load(): MockState {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
    } catch {
      return empty();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* storage blocked: keep working in memory */
    }
  }
}
