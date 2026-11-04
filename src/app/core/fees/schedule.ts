import { FeeFrequency } from '../models/models';

/*
 * When each kind of fee falls due. The .NET API's due-generation job (Hangfire) should follow the same rules:
 *
 *  Monthly     every month
 *  Quarterly   session start month, +3, +6, +9        (April session: Apr, Jul, Oct, Jan)
 *  HalfYearly  session start month and +6             (Apr, Oct) — "term-wise" with 2 terms
 *  Yearly      session start month, or the month a student joins if they join mid-session
 *  OneTime     only in the month the student joins (admission fee); existing students are never charged
 */

export const FREQUENCY_LABELS: Record<FeeFrequency, string> = {
  Monthly: 'Monthly',
  Quarterly: 'Quarterly',
  HalfYearly: 'Term-wise (2 terms)',
  Yearly: 'Yearly',
  OneTime: 'One-time (on joining)',
};

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(monthKey: string): [number, number] {
  const [y, m] = monthKey.split('-').map(Number);
  return [y!, m!];
}

/** Months since the session started, 0–11. */
function offset(month: number, sessionStart: number): number {
  return (month - sessionStart + 12) % 12;
}

export function sessionYear(monthKey: string, sessionStart: number): number {
  const [y, m] = parts(monthKey);
  return m >= sessionStart ? y : y - 1;
}

export function sessionLabel(sy: number): string {
  return `${sy}–${String((sy + 1) % 100).padStart(2, '0')}`;
}

/** Does a head with this frequency fall due in `monthKey`? `joinedMonth` is the student's joining month (YYYY-MM). */
export function isDueIn(freq: FeeFrequency, monthKey: string, sessionStart: number, joinedMonth: string): boolean {
  if (monthKey < joinedMonth) return false;
  const [, m] = parts(monthKey);
  const off = offset(m, sessionStart);
  switch (freq) {
    case 'Monthly':
      return true;
    case 'Quarterly':
      return off % 3 === 0 || monthKey === joinedMonth;
    case 'HalfYearly':
      return off % 6 === 0 || monthKey === joinedMonth;
    case 'Yearly':
      return off === 0 || monthKey === joinedMonth;
    case 'OneTime':
      return monthKey === joinedMonth;
  }
}

/** The period a due belongs to, used to avoid charging the same period twice. */
export function periodFor(freq: FeeFrequency, monthKey: string, sessionStart: number): { period: string; label: string } {
  const [y, m] = parts(monthKey);
  const sy = sessionYear(monthKey, sessionStart);
  const off = offset(m, sessionStart);
  switch (freq) {
    case 'Monthly':
      return { period: monthKey, label: `${MONTHS_SHORT[m - 1]} ${y}` };
    case 'Quarterly': {
      const q = Math.floor(off / 3) + 1;
      const from = MONTHS_SHORT[(sessionStart - 1 + (q - 1) * 3) % 12];
      const to = MONTHS_SHORT[(sessionStart - 1 + (q - 1) * 3 + 2) % 12];
      return { period: `${sy}-Q${q}`, label: `Q${q} · ${from}–${to}` };
    }
    case 'HalfYearly': {
      const t = off < 6 ? 1 : 2;
      return { period: `${sy}-T${t}`, label: `Term ${t} · ${sessionLabel(sy)}` };
    }
    case 'Yearly':
      return { period: `${sy}-Y`, label: sessionLabel(sy) };
    case 'OneTime':
      return { period: 'OT', label: 'One-time' };
  }
}
