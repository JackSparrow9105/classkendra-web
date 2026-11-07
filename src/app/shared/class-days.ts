const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Does a batch with this `days` text meet on the given date?
 * Understands "Mon,Wed,Fri", "Mon, Wed, Fri", "Mon–Sat", "Mon-Fri" and "Daily".
 * No days (schools) = Monday to Saturday. Same rules as ClassDays.MeetsOn in the API.
 */
export function meetsOn(days: string | null | undefined, date = new Date()): boolean {
  const today = date.getDay();
  const text = (days ?? '').trim();
  if (!text) return today !== 0;
  if (/daily|every ?day/i.test(text)) return true;

  const range = text.match(/^([A-Za-z]{3})\w*\s*[–—-]\s*([A-Za-z]{3})\w*$/);
  if (range) {
    const from = DAYS.findIndex((d) => d.toLowerCase() === range[1]!.toLowerCase());
    const to = DAYS.findIndex((d) => d.toLowerCase() === range[2]!.toLowerCase());
    if (from < 0 || to < 0) return false;
    return from <= to ? today >= from && today <= to : today >= from || today <= to;
  }

  return text
    .split(/[,\s/]+/)
    .filter(Boolean)
    .some((d) => d.slice(0, 3).toLowerCase() === DAYS[today]!.toLowerCase());
}
