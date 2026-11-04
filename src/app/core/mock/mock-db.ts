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
  MessageLog,
  MessageType,
  Payment,
  PaymentMode,
  StaffMember,
  Student,
} from '../models/models';
import { discountFor } from '../fees/concessions';
import { isDueIn, periodFor, sessionYear } from '../fees/schedule';
import { feeReminderText, receiptText } from '../messages/templates';
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
  payments: Payment[];
  /** Last receipt number used, per session year: { "2026": 41 } */
  receiptSeq: Record<string, number>;
  feeSettings: FeeSettings | null;
  staff: StaffMember[];
  attendance: Record<string, string[]>;
  messages: MessageLog[];
}

const KEY = 'classkendra-mock-v3';

function empty(): MockState {
  return {
    token: null,
    user: null,
    centre: null,
    batches: [],
    students: [],
    heads: [],
    dues: [],
    payments: [],
    receiptSeq: {},
    feeSettings: null,
    staff: [],
    attendance: {},
    messages: [],
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

  /** Adds a row to the WhatsApp outbox. The API's Hangfire job sends it and the provider webhook updates the status. */
  logMessage(m: { studentId: string | null; recipientName: string; phone: string; type: MessageType; text: string }, at = new Date()): void {
    const now = at.toISOString();
    this.state.messages.push({ id: this.id('msg'), ...m, status: 'Queued', error: null, createdAt: now, updatedAt: now });
    if (this.state.centre) this.state.centre.messagesUsed++;
  }

  /** Public payment link for a student. The API stores a random token per student instead. */
  payLink(studentId: string): string {
    const base = document.querySelector('base')?.getAttribute('href') ?? '/';
    return `${location.origin}${base}pay/pt_${studentId}`;
  }

  /** "R-2026-0042": a running number per session, never reused. The API does this inside a transaction. */
  nextReceiptNo(paidOn: string): string {
    const sy = String(sessionYear(paidOn.slice(0, 7), this.state.feeSettings?.sessionStartMonth ?? 4));
    const n = (this.state.receiptSeq[sy] ?? 0) + 1;
    this.state.receiptSeq[sy] = n;
    return `R-${sy}-${String(n).padStart(4, '0')}`;
  }

  /**
   * Raises dues for one month for every active student, following core/fees/schedule.ts,
   * with each student's concessions applied. Mirrors the nightly Hangfire job in the API.
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
        const gross = head.amounts[st.batchId] ?? 0;
        if (!gross) continue;
        if (head.optional && !st.optionalHeadIds.includes(head.id)) continue;
        if (!isDueIn(head.frequency, month, start, joined)) continue;
        const { period, label } = periodFor(head.frequency, month, start);
        if (s.dues.some((d) => d.studentId === st.id && d.feeHeadId === head.id && d.period === period)) continue;
        const discount = discountFor(st.concessions ?? [], head.id, gross);
        if (gross - discount <= 0) continue; // full scholarship: nothing to bill
        s.dues.push({
          id: this.id('due'),
          studentId: st.id,
          batchId: st.batchId,
          feeHeadId: head.id,
          headName: head.name,
          period,
          periodLabel: label,
          month,
          grossAmount: gross,
          discount,
          amount: gross - discount,
          paidAmount: 0,
          dueDate: `${month}-${day}`,
          status: 'Pending',
          lastPaidOn: null,
          remindersSent: 0,
        });
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** After a student's concessions change, re-price their bills that have no money against them yet. */
  repriceUnpaid(studentId: string): void {
    const st = this.state.students.find((x) => x.id === studentId);
    if (!st) return;
    this.state.dues = this.state.dues.filter((d) => {
      if (d.studentId !== studentId || d.paidAmount > 0) return true;
      d.discount = discountFor(st.concessions, d.feeHeadId, d.grossAmount);
      d.amount = d.grossAmount - d.discount;
      return d.amount > 0;
    });
    this.save();
  }

  /** Applies money to dues oldest first; returns the allocations. Shared by the payment service and sample data. */
  allocate(dues: FeeDue[], amount: number, paidOn: string): Payment['allocations'] {
    const allocations: Payment['allocations'] = [];
    let left = amount;
    for (const d of [...dues].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      if (left <= 0) break;
      const take = Math.min(left, d.amount - d.paidAmount);
      if (take <= 0) continue;
      d.paidAmount += take;
      d.status = d.paidAmount >= d.amount ? 'Paid' : 'Partial';
      d.lastPaidOn = paidOn;
      allocations.push({ dueId: d.id, headName: d.headName, periodLabel: d.periodLabel, amount: take });
      left -= take;
    }
    return allocations;
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
      concessions: [],
    }));
    // A few discounts so the feature is visible.
    s.students[1]!.concessions = [{ id: 'c_1', reason: 'Sibling', note: 'Younger brother also studies here', feeHeadId: 'h_tuition', kind: 'Percent', value: 10 }];
    s.students[4]!.concessions = [{ id: 'c_2', reason: 'Scholarship', note: 'Merit scholarship', feeHeadId: 'h_tuition', kind: 'Percent', value: 50 }];
    s.students[10]!.concessions = [{ id: 'c_3', reason: 'Staff child', note: '', feeHeadId: null, kind: 'Amount', value: 500 }];

    s.feeSettings = { dueDay: 5, sessionStartMonth: 4, remindBefore: true, remindOnDue: true, remindAfter: true };
    s.staff = isSchool
      ? [{ id: 'st_1', name: 'Kavita Mishra', phone: '9811100001', role: 'Teacher', batchIds: ['b_5A', 'b_5B'] }]
      : [];
    s.dues = [];
    s.payments = [];
    s.receiptSeq = {};
    s.attendance = {};
    s.messages = [];
    this.ensureDues(prevMonth);
    this.ensureDues(thisMonth);

    const pay = (studentId: string, month: string, paidOn: string, mode: PaymentMode, part?: number) => {
      const dues = s.dues.filter((d) => d.studentId === studentId && d.month === month && d.status !== 'Paid');
      const total = dues.reduce((t, d) => t + d.amount - d.paidAmount, 0);
      const amount = part ? Math.min(part, total) : total;
      if (amount <= 0) return;
      const allocations = this.allocate(dues, amount, paidOn);
      s.payments.push({
        id: this.id('pay'), receiptNo: this.nextReceiptNo(paidOn), studentId, amount, mode, paidOn, note: '',
        receivedBy: s.centre?.ownerName || 'Office', allocations,
      });
    };

    // Last month: most families paid; two are still late, one paid only part.
    s.students.forEach((st, i) => {
      if (st.id === 's_1' || st.id === 's_7') return;
      if (st.id === 's_4') return pay(st.id, prevMonth, `${prevMonth}-07`, 'Cash', 1000);
      pay(st.id, prevMonth, `${prevMonth}-0${(i % 5) + 4}`, i % 3 === 0 ? 'Cash' : 'UPI');
    });
    // This month: about 60% paid so far.
    s.students.forEach((st, i) => {
      if (i % 5 < 3 && st.id !== 's_1') pay(st.id, thisMonth, isoDate(today), i % 2 ? 'Cash' : 'UPI');
    });

    // Message history: yesterday's reminders to late families, and a WhatsApp receipt for each payment.
    const org = s.centre?.name ?? '';
    const yesterday = new Date(today.getTime() - 86_400_000);
    for (const st of s.students) {
      const owed = s.dues.filter((d) => d.studentId === st.id && d.status !== 'Paid' && d.month === prevMonth);
      if (!owed.length) continue;
      const amount = owed.reduce((t, d) => t + d.amount - d.paidAmount, 0);
      this.logMessage({ studentId: st.id, recipientName: st.parentName, phone: st.parentPhone, type: 'FeeReminder',
        text: feeReminderText('en', { org, student: st.name, amount, dueText: 'overdue', link: this.payLink(st.id) }) }, yesterday);
    }
    for (const p of s.payments) {
      const st = s.students.find((x) => x.id === p.studentId)!;
      this.logMessage({ studentId: st.id, recipientName: st.parentName, phone: st.parentPhone, type: 'Receipt',
        text: receiptText('en', { org, student: st.name, amount: p.amount, receiptNo: p.receiptNo, balance: 0 }) }, new Date(`${p.paidOn}T10:30:00`));
    }
    if (s.centre) s.centre.messagesUsed = s.messages.length;
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
