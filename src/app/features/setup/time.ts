/** "16:00" -> "4:00 PM" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h! >= 12 ? 'PM' : 'AM';
  const hour = h! % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}
