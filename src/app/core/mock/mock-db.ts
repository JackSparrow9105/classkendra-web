import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  AuthUser,
  Batch,
  Centre,
  FeeDue,
  FeeHead,
  FeeSettings,
  StaffMember,
  Student,
} from '../models/models';
import { isDueIn, periodFor } from '../fees/schedule';
import { schoolGroupName } from '../labels';
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
  heads: FeeHead[];
  dues: FeeDue[];
  feeSettings: FeeSettings | null;
  staff: StaffMember[];
  attendance: Record<string, string[]>;
}

const KEY = 'classkendra-mock-v2';

function empty(): MockState {
  return {
    token: null,
    user: null,
    centre: null,
    batches: [],
    students: [],
    heads: [],
    dues: [],
    feeSettings: null,
    staff: [],
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

  clearAll(): void {
    this.state = empty();
    this.save();
  }

  /**
   * Raises dues for one month for every active student, following core/fees/schedule.ts.
   * Mirrors the nightly Hangfire job in the API.
   */
  ensureDues(month = monthKey()): void {
    const s = this.state;
    if (!s.feeSettings || s.heads.length === 0) return;
    const day = String(Math.min(s.feeSettings.dueDay, 28)).padStart(2, '0');
    const start = s.feeSettings.sessionStartMonth;
    let changed = false;

    for (const st of s.students.filter((x) => x.active)) {
      const joined = st.joinedOn.slice(0, 7);
      for (const head of s.heads) {
        const amount = head.amounts[st.batchId] ?? 0;
        if (!amount) continue;
        if (head.optional && !st.optionalHeadIds.includes(head.id)) continue;
        if (!isDueIn(head.frequency, month, start, joined)) continue;
        const { period, label } = periodFor(head.frequency, month, start);
        if (s.dues.some((d) => d.studentId === st.id && d.feeHeadId === head.id && d.period === period)) continue;
        s.dues.push({
          id: this.id('due'),
          studentId: st.id,
          batchId: st.batchId,
          feeHeadId: head.id,
          headName: head.name,
          period,
          periodLabel: label,
          month,
          amount,
          dueDate: `${month}-${day}`,
          status: 'Pending',
          paidOn: null,
          paidAmount: null,
          mode: null,
          remindersSent: 0,
        });
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** Fills the account with realistic sample data so every screen can be tried. */
  seedSample(): void {
    const s = this.state;
    const isSchool = s.centre?.institutionType === 'School';
    const today = new Date();
    const thisMonth = monthKey(today);
    const prevMonth = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    const joined = isoDate(new Date(today.getFullYear(), today.getMonth() - 3, 1));

    if (isSchool) {
      const groups: [string, string][] = [['5', 'A'], ['5', 'B'], ['8', 'A'], ['10', 'A']];
      s.batches = groups.map(([c, sec]) => ({
        id: `b_${c}${sec}`, name: schoolGroupName(c, sec), className: c, section: sec, days: null, startTime: null, endTime: null,
      }));
      s.heads = [
        { id: 'h_tuition', name: 'Tuition fee', frequency: 'Monthly', optional: false, amounts: { b_5A: 1800, b_5B: 1800, b_8A: 2400, b_10A: 3000 } },
        { id: 'h_transport', name: 'Transport', frequency: 'Monthly', optional: true, amounts: { b_5A: 1200, b_5B: 1200, b_8A: 1200, b_10A: 1200 } },
        { id: 'h_exam', name: 'Exam fee', frequency: 'HalfYearly', optional: false, amounts: { b_5A: 500, b_5B: 500, b_8A: 700, b_10A: 900 } },
      ];
    } else {
      s.batches = [
        { id: 'b_10m', name: 'Class 10 · Maths', className: null, section: null, days: 'Mon–Sat', startTime: '16:00', endTime: '17:00' },
        { id: 'b_12p', name: 'Class 12 · Physics', className: null, section: null, days: 'Mon–Sat', startTime: '17:15', endTime: '18:30' },
        { id: 'b_jee', name: 'JEE Batch A', className: null, section: null, days: 'Mon, Wed, Fri', startTime: '07:00', endTime: '09:00' },
      ];
      s.heads = [
        { id: 'h_tuition', name: 'Tuition fee', frequency: 'Monthly', optional: false, amounts: { b_10m: 2500, b_12p: 3000, b_jee: 4000 } },
      ];
    }

    const names: [string, string][] = [
      ['Aarav Gupta', 'Rajesh Gupta'], ['Ananya Rao', 'Sunita Rao'], ['Ishaan Mehta', 'Vikram Mehta'], ['Kabir Joshi', 'Neeta Joshi'],
      ['Meera Nair', 'Lakshmi Nair'], ['Sara Khan', 'Imran Khan'], ['Priya Singh', 'Amit Singh'], ['Rohan Kumar', 'Suresh Kumar'],
      ['Diya Sharma', 'Pooja Sharma'], ['Arjun Patel', 'Ketan Patel'], ['Tanvi Desai', 'Hema Desai'], ['Neha Verma', 'Anil Verma'],
      ['Vivaan Reddy', 'Kiran Reddy'], ['Aditi Iyer', 'Ramesh Iyer'], ['Kunal Bose', 'Arup Bose'], ['Riya Malhotra', 'Sanjay Malhotra'],
    ];
    s.students = names.map(([name, parent], i) => ({
      id: `s_${i + 1}`,
      name,
      parentName: parent,
      parentPhone: `98${String(10000000 + i * 734521).slice(0, 8)}`,
      batchId: s.batches[i % s.batches.length]!.id,
      joinedOn: joined,
      active: true,
      optionalHeadIds: isSchool && i % 3 === 0 ? ['h_transport'] : [],
    }));
    s.feeSettings = { dueDay: 5, sessionStartMonth: 4, remindBefore: true, remindOnDue: true, remindAfter: true };
    s.staff = isSchool
      ? [{ id: 'st_1', name: 'Kavita Mishra', phone: '9811100001', role: 'Teacher', batchIds: ['b_5A', 'b_5B'] }]
      : [];
    s.dues = [];
    s.attendance = {};
    this.ensureDues(prevMonth);
    this.ensureDues(thisMonth);

    // Most of last month is paid; two families are still late.
    for (const d of s.dues.filter((x) => x.month === prevMonth)) {
      if (d.studentId === 's_1' || d.studentId === 's_7') continue;
      Object.assign(d, { status: 'Paid', paidOn: `${prevMonth}-06`, paidAmount: d.amount, mode: 'UPI' });
    }
    // About 60% of this month is paid so far.
    const paidThisMonth = new Set(s.students.filter((_, i) => i % 5 < 3).map((x) => x.id));
    paidThisMonth.delete('s_1');
    for (const d of s.dues.filter((x) => x.month === thisMonth && paidThisMonth.has(x.studentId))) {
      Object.assign(d, { status: 'Paid', paidOn: isoDate(today), paidAmount: d.amount, mode: 'Cash' });
    }
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
