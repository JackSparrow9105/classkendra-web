import { Concession, ConcessionReason } from '../models/models';

export const CONCESSION_REASONS: ConcessionReason[] = ['Sibling', 'Staff child', 'Scholarship', 'Other'];

/**
 * Discount on one bill line. Rules (the API must use the same):
 *  - concessions for this head and for "all heads" both apply
 *  - percentages are taken on the gross amount, then fixed amounts are taken off
 *  - the discount never exceeds the gross amount
 */
export function discountFor(concessions: Concession[], feeHeadId: string, gross: number): number {
  let discount = 0;
  const applicable = concessions.filter((c) => c.feeHeadId === null || c.feeHeadId === feeHeadId);
  for (const c of applicable.filter((x) => x.kind === 'Percent')) discount += Math.round((gross * c.value) / 100);
  for (const c of applicable.filter((x) => x.kind === 'Amount')) discount += c.value;
  return Math.min(discount, gross);
}

export function describeConcession(c: Concession, headName: string | null): string {
  const what = c.kind === 'Percent' ? `${c.value}% off` : `₹${c.value.toLocaleString('en-IN')} off`;
  return `${what} ${headName ? headName.toLowerCase() : 'all fees'}`;
}
