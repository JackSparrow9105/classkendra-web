import { Injectable, inject, signal } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MockDb } from '../mock/mock-db';
import {
  LeaveRequest, MyStaffToday, StaffAttendanceSettings, StaffAvailability, StaffCounts, StaffDay, StaffDayStatus,
  StaffMarkStatus, StaffMonth, StaffReport, StaffToday, StaffTodayRow,
} from '../models/models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/**
 * Staff attendance for schools (School 200 and above): teachers and office staff check in at school,
 * apply for leave; the owner sees today, marks or corrects, approves leave, downloads the report.
 * Same rules as the API: late after start + 10 min, holidays/weekly offs never count, approved leave = Leave,
 * no check-in on a working day = Absent once the school day is over.
 */
@Injectable({ providedIn: 'root' })
export class StaffAttendanceService {
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockDb);
  private readonly auth = inject(AuthService);

  /** null until loaded. */
  readonly availability = signal<StaffAvailability | null>(null);

  /** GET /staff-attendance/status (cached for this session). */
  status(force = false): Observable<StaffAvailability> {
    const known = this.availability();
    if (known && !force) return of(known);
    const call$: Observable<StaffAvailability> = environment.useMock
      ? this.mock.respond(this.demoAvailability(), 80)
      : this.api.get<StaffAvailability>('staff-attendance/status');
    return call$.pipe(tap((a) => this.availability.set(a)));
  }

  // ---------- teacher / office staff ----------

  myToday(): Observable<MyStaffToday> {
    if (!environment.useMock) return this.api.get<MyStaffToday>('staff-attendance/me/today');
    return this.mock.respond(this.demoMyToday(), 120);
  }

  checkIn(latitude: number, longitude: number, accuracy: number | null): Observable<MyStaffToday> {
    if (!environment.useMock) return this.api.post<MyStaffToday>('staff-attendance/me/check-in', { latitude, longitude, accuracy });
    const st = this.store();
    const today = isoDay(new Date());
    const cal = this.calendar(st);
    if (cal.holiday(today)) return this.mock.fail(`Today is a holiday (${cal.holiday(today)}).`);
    if (cal.off(today)) return this.mock.fail('Today is your weekly off.');
    if (st.settings.latitude == null || st.settings.longitude == null)
      return this.mock.fail("The principal hasn't set the school location yet. Ask them to set it in Staff attendance settings.");
    const d = distance(latitude, longitude, st.settings.latitude, st.settings.longitude!);
    if (d - Math.min(Math.max(accuracy ?? 0, 0), 50) > st.settings.radius)
      return this.mock.fail(`You're ${Math.round(d / 10) * 10} m from school. Check in when you reach.`);
    const me = this.me();
    const key = `${me.id}|${today}`;
    if (!st.records[key]?.checkInAt) {
      const p = this.person(me.id, st)!;
      const late = lateness(nowHm(), p.start, st.settings.graceMinutes);
      st.records[key] = { status: late.isLate ? 'Late' : 'Present', checkInAt: new Date().toISOString(), checkOutAt: null, lateMinutes: late.minutes, byOwner: false };
      this.save(st);
    }
    return this.mock.respond(this.demoMyToday());
  }

  checkOut(): Observable<MyStaffToday> {
    if (!environment.useMock) return this.api.post<MyStaffToday>('staff-attendance/me/check-out', {});
    const st = this.store();
    const r = st.records[`${this.me().id}|${isoDay(new Date())}`];
    if (!r?.checkInAt) return this.mock.fail('Check in first.');
    r.checkOutAt = new Date().toISOString();
    this.save(st);
    return this.mock.respond(this.demoMyToday());
  }

  myMonth(month: string): Observable<StaffMonth> {
    if (!environment.useMock) return this.api.get<StaffMonth>('staff-attendance/me/month', { month });
    const [from, to] = monthRange(month);
    const days = this.days(this.me().id, from, to);
    return this.mock.respond({ month, days, counts: count(days) });
  }

  myLeaves(): Observable<LeaveRequest[]> {
    if (!environment.useMock) return this.api.get<LeaveRequest[]>('staff-attendance/me/leaves');
    return this.mock.respond(this.leaveList(this.store().leaves.filter((l) => l.userId === this.me().id), false));
  }

  applyLeave(from: string, to: string, reason: string): Observable<LeaveRequest> {
    if (!environment.useMock) return this.api.post<LeaveRequest>('staff-attendance/me/leaves', { from, to, reason });
    const st = this.store();
    const me = this.me();
    if (!from || !to) return this.mock.fail('Choose the dates.');
    if (to < from) return this.mock.fail("The last day can't be before the first day.");
    if (!reason.trim()) return this.mock.fail('Write a reason.');
    const days = this.calendar(st).workingDays(from, to);
    if (days === 0) return this.mock.fail('These dates are all holidays or weekly offs.');
    if (st.leaves.some((l) => l.userId === me.id && l.status !== 'Rejected' && l.from <= to && l.to >= from))
      return this.mock.fail('You already applied for leave on some of these days.');
    const l: DemoLeave = { id: this.mock.id('lv'), userId: me.id, from, to, days, reason: reason.trim(), status: 'Pending', rejectReason: null, createdAt: new Date().toISOString(), decidedAt: null };
    st.leaves.push(l);
    this.save(st);
    if (st.settings.notifyLeaveRequests && st.settings.leaveWhatsApp) this.demoMessage('LeaveRequest', l);
    return this.mock.respond(this.leaveList([l], false)[0]!);
  }

  withdrawLeave(id: string): Observable<void> {
    if (!environment.useMock) return this.api.delete<void>(`staff-attendance/me/leaves/${id}`);
    const st = this.store();
    st.leaves = st.leaves.filter((l) => !(l.id === id && l.status === 'Pending'));
    this.save(st);
    return this.mock.respond(undefined);
  }

  // ---------- owner ----------

  today(date?: string): Observable<StaffToday> {
    if (!environment.useMock) return this.api.get<StaffToday>('staff-attendance/today', { date });
    const day = date ?? isoDay(new Date());
    const st = this.store();
    const cal = this.calendar(st);
    const rows: StaffTodayRow[] = this.people(st).map((p) => {
      const x = this.days(p.id, day, day)[0]!;
      return { userId: p.id, name: p.name, role: p.role, status: x.status, checkInAt: x.checkInAt, checkOutAt: x.checkOutAt, lateMinutes: x.lateMinutes, markedByOwner: x.markedByOwner, start: p.start, end: p.end };
    });
    return this.mock.respond({
      date: day, dayType: cal.holiday(day) ? 'Holiday' : cal.off(day) ? 'WeeklyOff' : 'Working', holidayName: cal.holiday(day),
      start: st.settings.start, end: st.settings.end, rows,
    });
  }

  mark(userId: string, date: string, status: StaffMarkStatus, checkIn: string | null): Observable<StaffTodayRow> {
    if (!environment.useMock) return this.api.put<StaffTodayRow>('staff-attendance/mark', { userId, date, status, checkIn });
    const st = this.store();
    const key = `${userId}|${date}`;
    const p = this.person(userId, st)!;
    if (status === 'Clear') delete st.records[key];
    else {
      const withTime = (status === 'Present' || status === 'Late') && checkIn;
      st.records[key] = {
        status,
        checkInAt: withTime ? new Date(`${date}T${checkIn}:00`).toISOString() : null,
        checkOutAt: null,
        lateMinutes: withTime ? lateness(checkIn!, p.start, st.settings.graceMinutes).minutes : 0,
        byOwner: true,
      };
    }
    this.save(st);
    const x = this.days(userId, date, date)[0]!;
    return this.mock.respond({ userId, name: p.name, role: p.role, status: x.status, checkInAt: x.checkInAt, checkOutAt: x.checkOutAt, lateMinutes: x.lateMinutes, markedByOwner: x.markedByOwner, start: p.start, end: p.end });
  }

  leaves(): Observable<LeaveRequest[]> {
    if (!environment.useMock) return this.api.get<LeaveRequest[]>('staff-attendance/leaves');
    return this.mock.respond(this.leaveList(this.store().leaves, true));
  }

  decide(id: string, approve: boolean, reason: string | null): Observable<LeaveRequest> {
    if (!environment.useMock)
      return approve
        ? this.api.post<LeaveRequest>(`staff-attendance/leaves/${id}/approve`, {})
        : this.api.post<LeaveRequest>(`staff-attendance/leaves/${id}/reject`, { reason });
    const st = this.store();
    const l = st.leaves.find((x) => x.id === id);
    if (!l) return this.mock.fail('Leave request not found.');
    if (l.status !== 'Pending') return this.mock.fail(`This request is already ${l.status.toLowerCase()}.`);
    l.status = approve ? 'Approved' : 'Rejected';
    l.rejectReason = approve ? null : reason?.trim() || null;
    l.decidedAt = new Date().toISOString();
    this.save(st);
    if (st.settings.notifyLeaveAnswers && st.settings.leaveWhatsApp) this.demoMessage('LeaveAnswer', l);
    return this.mock.respond(this.leaveList([l], true)[0]!);
  }

  report(month: string): Observable<StaffReport> {
    if (!environment.useMock) return this.api.get<StaffReport>('staff-attendance/report', { month });
    const st = this.store();
    const [from, to] = monthRange(month);
    const today = isoDay(new Date());
    const last = to > today ? today : to;
    const cal = this.calendar(st);
    let holidays = 0;
    for (const d of eachDay(from, last)) if (cal.holiday(d)) holidays++;
    const rows = this.people(st).map((p) => {
      const days = this.days(p.id, from, to);
      return { userId: p.id, name: p.name, role: p.role, counts: count(days), days };
    });
    return this.mock.respond({ month, from, to: last, workingDays: cal.workingDays(from, last), holidays, rows });
  }

  settings(): Observable<StaffAttendanceSettings> {
    if (!environment.useMock) return this.api.get<StaffAttendanceSettings>('staff-attendance/settings');
    return this.mock.respond(this.demoSettings(), 120);
  }

  saveTiming(start: string, end: string, weeklyOff: number[]): Observable<StaffAttendanceSettings> {
    if (!environment.useMock) return this.api.put<StaffAttendanceSettings>('staff-attendance/settings', { start, end, weeklyOff });
    if (!start || !end) return this.mock.fail('Enter the school timing.');
    if (end <= start) return this.mock.fail('School must end after it starts.');
    if (weeklyOff.length > 3) return this.mock.fail('Choose at most 3 weekly off days.');
    return this.demoUpdate((s) => Object.assign(s.settings, { start, end, weeklyOff: [...weeklyOff].sort() }));
  }

  saveLocation(latitude: number, longitude: number): Observable<StaffAttendanceSettings> {
    if (!environment.useMock) return this.api.put<StaffAttendanceSettings>('staff-attendance/settings/location', { latitude, longitude });
    return this.demoUpdate((s) => Object.assign(s.settings, { latitude: round6(latitude), longitude: round6(longitude) }));
  }

  /** PUT /staff-attendance/settings/radius — how far from school staff can check in (50 to 1,000 m). */
  saveRadius(radius: number): Observable<StaffAttendanceSettings> {
    return this.api.put<StaffAttendanceSettings>('staff-attendance/settings/radius', { radius });
  }

  saveNotifications(notifyLeaveRequests: boolean, notifyLeaveAnswers: boolean, leaveWhatsApp: boolean): Observable<StaffAttendanceSettings> {
    if (!environment.useMock)
      return this.api.put<StaffAttendanceSettings>('staff-attendance/settings/notifications', { notifyLeaveRequests, notifyLeaveAnswers, leaveWhatsApp });
    return this.demoUpdate((s) => Object.assign(s.settings, { notifyLeaveRequests, notifyLeaveAnswers, leaveWhatsApp }));
  }

  addHoliday(name: string, from: string, to: string): Observable<StaffAttendanceSettings> {
    if (!environment.useMock) return this.api.post<StaffAttendanceSettings>('staff-attendance/holidays', { name, from, to });
    if (!name.trim()) return this.mock.fail('Give the holiday a name (up to 60 letters).');
    if (!from) return this.mock.fail('Choose the date.');
    if ((to || from) < from) return this.mock.fail("The last day can't be before the first day.");
    return this.demoUpdate((s) => s.holidays.push({ id: this.mock.id('hol'), name: name.trim(), from, to: to || from }));
  }

  deleteHoliday(id: string): Observable<StaffAttendanceSettings> {
    if (!environment.useMock) return this.api.delete<StaffAttendanceSettings>(`staff-attendance/holidays/${id}`);
    return this.demoUpdate((s) => (s.holidays = s.holidays.filter((h) => h.id !== id)));
  }

  savePersonTiming(userId: string, start: string | null, end: string | null): Observable<StaffAttendanceSettings> {
    if (!environment.useMock) return this.api.put<StaffAttendanceSettings>(`staff-attendance/timings/${userId}`, { start, end });
    if ((start || end) && (!start || !end)) return this.mock.fail('Enter both times.');
    if (start && end && end <= start) return this.mock.fail('The end time must be after the start time.');
    return this.demoUpdate((s) => {
      if (start && end) s.timings[userId] = { start, end };
      else delete s.timings[userId];
    });
  }

  // ================= Demo mode =================

  private store(): DemoStore {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw) as DemoStore;
    } catch {
      /* fresh demo data below */
    }
    return this.seed();
  }

  private save(st: DemoStore): void {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(st));
    } catch {
      /* private mode: demo data lasts until reload */
    }
  }

  /** Demo: the school's sample month so every screen has something to show. */
  private seed(): DemoStore {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const st: DemoStore = {
      settings: { start: '07:30', end: '13:30', graceMinutes: 10, latitude: null, longitude: null, radius: 200, weeklyOff: [0], notifyLeaveRequests: true, notifyLeaveAnswers: true, leaveWhatsApp: false },
      holidays: [],
      timings: {},
      records: {},
      leaves: [],
    };
    const people = this.people(st);
    const from = isoDay(new Date(y, m, 1));
    const yesterday = isoDay(new Date(y, m, now.getDate() - 1));
    let i = 0;
    for (const d of eachDay(from, yesterday)) {
      if (new Date(`${d}T00:00:00`).getDay() === 0) continue;
      people.forEach((p, k) => {
        i++;
        const r = (i * 7 + k * 3) % 23;
        if (r === 0) return; // absent
        const late = r % 6 === 0;
        const mins = late ? 12 + (r % 20) : r % 8;
        const [h, mm] = p.start.split(':').map(Number) as [number, number];
        const at = new Date(`${d}T00:00:00`);
        at.setHours(h, mm - 6 + (late ? mins + 6 : mins));
        const out = new Date(`${d}T00:00:00`);
        const [eh, em] = p.end.split(':').map(Number) as [number, number];
        out.setHours(eh, em + (r % 9));
        st.records[`${p.id}|${d}`] = { status: late ? 'Late' : 'Present', checkInAt: at.toISOString(), checkOutAt: out.toISOString(), lateMinutes: late ? mins : 0, byOwner: false };
      });
    }
    if (people[0]) {
      const a = isoDay(new Date(y, m, now.getDate() + 3));
      const b = isoDay(new Date(y, m, now.getDate() + 4));
      st.leaves.push({ id: 'lv_demo1', userId: people[0].id, from: a, to: b, days: 2, reason: 'Family function', status: 'Pending', rejectReason: null, createdAt: new Date().toISOString(), decidedAt: null });
    }
    this.save(st);
    return st;
  }

  private demoAvailability(): StaffAvailability {
    const c = this.mock.snapshot.centre;
    if (c?.institutionType !== 'School') return { enabled: false, reason: 'NotSchool' };
    return { enabled: true, reason: null };
  }

  private me(): { id: string } {
    return { id: this.auth.user()?.id ?? '' };
  }

  private people(st: DemoStore): DemoPerson[] {
    const joined = isoDay(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1));
    return [...this.mock.snapshot.staff]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({
        id: m.id, name: m.name, role: m.role as 'Teacher' | 'Staff', joined,
        start: st.timings[m.id]?.start ?? st.settings.start,
        end: st.timings[m.id]?.end ?? st.settings.end,
      }));
  }

  private person(id: string, st: DemoStore): DemoPerson | undefined {
    return this.people(st).find((p) => p.id === id);
  }

  private calendar(st: DemoStore) {
    const holiday = (d: string) => st.holidays.find((h) => h.from <= d && d <= h.to)?.name ?? null;
    const off = (d: string) => st.settings.weeklyOff.includes(new Date(`${d}T00:00:00`).getDay());
    return {
      holiday,
      off,
      workingDays: (from: string, to: string) => eachDay(from, to).filter((d) => !holiday(d) && !off(d)).length,
    };
  }

  private days(userId: string, from: string, to: string): StaffDay[] {
    const st = this.store();
    const p = this.person(userId, st);
    const cal = this.calendar(st);
    const today = isoDay(new Date());
    const now = nowHm();
    return eachDay(from, to).map((d) => {
      const r = st.records[`${userId}|${d}`];
      if (r) return { date: d, status: r.status, checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, lateMinutes: r.lateMinutes, markedByOwner: r.byOwner, note: null };
      let status: StaffDayStatus;
      let note: string | null = null;
      if (!p || d < p.joined) status = 'None';
      else if (cal.holiday(d)) { status = 'Holiday'; note = cal.holiday(d); }
      else if (cal.off(d)) status = 'WeeklyOff';
      else if (st.leaves.some((l) => l.userId === userId && l.status === 'Approved' && l.from <= d && d <= l.to)) status = 'Leave';
      else if (d > today) status = 'Upcoming';
      else if (d === today && now < p.end) status = 'NotYet';
      else status = 'Absent';
      return { date: d, status, checkInAt: null, checkOutAt: null, lateMinutes: 0, markedByOwner: false, note };
    });
  }

  private demoMyToday(): MyStaffToday {
    const st = this.store();
    const me = this.me();
    const p = this.person(me.id, st);
    const today = isoDay(new Date());
    const monthStart = `${today.slice(0, 7)}-01`;
    const days = this.days(me.id, monthStart, today);
    const t = days[days.length - 1]!;
    const start = p?.start ?? st.settings.start;
    return {
      date: today, start, end: p?.end ?? st.settings.end, lateAfter: addMinutes(start, st.settings.graceMinutes),
      status: t.status, holidayName: t.note, checkInAt: t.checkInAt, checkOutAt: t.checkOutAt, lateMinutes: t.lateMinutes,
      markedByOwner: t.markedByOwner, schoolLat: st.settings.latitude, schoolLng: st.settings.longitude, radius: st.settings.radius,
      month: count(days),
    };
  }

  private demoSettings(): StaffAttendanceSettings {
    const st = this.store();
    return {
      ...st.settings,
      holidays: [...st.holidays].sort((a, b) => a.from.localeCompare(b.from)),
      staff: this.people(st).map((p) => ({ userId: p.id, name: p.name, role: p.role, start: st.timings[p.id]?.start ?? null, end: st.timings[p.id]?.end ?? null })),
    };
  }

  private demoUpdate(fn: (s: DemoStore) => void): Observable<StaffAttendanceSettings> {
    const st = this.store();
    fn(st);
    this.save(st);
    return this.mock.respond(this.demoSettings());
  }

  private leaveList(list: DemoLeave[], withTaken: boolean): LeaveRequest[] {
    const st = this.store();
    const people = new Map(this.people(st).map((p) => [p.id, p]));
    return [...list]
      .sort((a, b) => Number(b.status === 'Pending') - Number(a.status === 'Pending') || b.createdAt.localeCompare(a.createdAt))
      .map((l) => ({
        ...l,
        name: people.get(l.userId)?.name ?? 'Staff',
        role: people.get(l.userId)?.role ?? 'Teacher',
        takenThisSession: withTaken ? st.leaves.filter((x) => x.userId === l.userId && x.status === 'Approved').reduce((n, x) => n + x.days, 0) : null,
      }));
  }

  /** Demo: the WhatsApp leave message, in the message log (only when the school turned WhatsApp on). */
  private demoMessage(type: 'LeaveRequest' | 'LeaveAnswer', l: DemoLeave): void {
    const s = this.mock.snapshot;
    const p = this.person(l.userId, this.store());
    const member = s.staff.find((m) => m.id === l.userId);
    const dates = datesLabel(l.from, l.to);
    if (type === 'LeaveRequest') {
      this.mock.update(() => this.mock.logMessage({
        studentId: null, recipientName: s.centre?.ownerName || 'Owner', phone: s.user?.phone ?? '', type,
        text: `${p?.name} applied for leave: ${dates} (${l.days} working day${l.days === 1 ? '' : 's'}). Reason: ${l.reason}. Open ClassKendra to approve or reject.`,
      }));
    } else {
      this.mock.update(() => this.mock.logMessage({
        studentId: null, recipientName: p?.name ?? '', phone: member?.phone ?? '', type,
        text: l.status === 'Approved' ? `Your leave for ${dates} is approved.` : `Your leave for ${dates} is not approved. Reason: ${l.rejectReason ?? 'No reason given'}.`,
      }));
    }
  }
}

// ---------- helpers (shared by the screens) ----------

const DEMO_KEY = 'classkendra-staff-attendance-v1';

interface DemoRecord { status: 'Present' | 'Late' | 'Absent' | 'Leave'; checkInAt: string | null; checkOutAt: string | null; lateMinutes: number; byOwner: boolean }
interface DemoLeave { id: string; userId: string; from: string; to: string; days: number; reason: string; status: 'Pending' | 'Approved' | 'Rejected'; rejectReason: string | null; createdAt: string; decidedAt: string | null }
interface DemoPerson { id: string; name: string; role: 'Teacher' | 'Staff'; joined: string; start: string; end: string }
interface DemoStore {
  settings: Omit<StaffAttendanceSettings, 'holidays' | 'staff'>;
  holidays: { id: string; name: string; from: string; to: string }[];
  timings: Record<string, { start: string; end: string }>;
  records: Record<string, DemoRecord>;
  leaves: DemoLeave[];
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (d <= end) {
    out.push(isoDay(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return [isoDay(new Date(y, m - 1, 1)), isoDay(new Date(y, m, 0))];
}

export function count(days: StaffDay[]): StaffCounts {
  const c: StaffCounts = { present: 0, late: 0, leave: 0, absent: 0 };
  for (const d of days) {
    if (d.status === 'Present') c.present++;
    else if (d.status === 'Late') c.late++;
    else if (d.status === 'Leave') c.leave++;
    else if (d.status === 'Absent') c.absent++;
  }
  return c;
}

/** Metres between two points. */
export function distance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nowHm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function addMinutes(hm: string, minutes: number): string {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function lateness(arrived: string, start: string, grace: number): { minutes: number; isLate: boolean } {
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const minutes = toMin(arrived) - toMin(start);
  return minutes <= 0 ? { minutes: 0, isLate: false } : { minutes, isLate: minutes > grace };
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** "07:30" → "7:30 am" */
export function timeLabel(hm: string | null | undefined): string {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** ISO instant → "7:26 am" (phone's time zone). */
export function clockLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return timeLabel(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
}

/** "2026-11-20", "2026-11-22" → "Fri 20 – Sun 22 Nov" */
export function datesLabel(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const day = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short' });
  const mon = (d: Date) => d.toLocaleDateString('en-IN', { month: 'short' });
  if (from === to) return `${day(f)} ${f.getDate()} ${mon(f)}`;
  if (f.getMonth() === t.getMonth()) return `${day(f)} ${f.getDate()} – ${day(t)} ${t.getDate()} ${mon(t)}`;
  return `${day(f)} ${f.getDate()} ${mon(f)} – ${day(t)} ${t.getDate()} ${mon(t)}`;
}

export const STATUS_LABEL: Record<StaffDayStatus, string> = {
  Present: 'On time', Late: 'Late', Absent: 'Absent', Leave: 'Leave', Holiday: 'Holiday',
  WeeklyOff: 'Weekly off', NotYet: 'Not in yet', Upcoming: '', None: '',
};
