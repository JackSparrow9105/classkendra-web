import { Lang } from '../models/models';

/*
 * WhatsApp template texts. In production each one is a template approved by Meta in your
 * WhatsApp Business account (one per language), and the API fills the {{1}}, {{2}}… variables.
 * Keep these in step with the approved wording.
 */

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function feeReminderText(lang: Lang, d: { org: string; student: string; amount: number; dueText: string; link: string }): string {
  return lang === 'hi'
    ? `नमस्ते! ${d.org} में ${d.student} की ${inr(d.amount)} फीस बाकी है (${d.dueText})। यहाँ भुगतान करें: ${d.link}`
    : `Namaste! ${d.student}'s fees of ${inr(d.amount)} at ${d.org} are due (${d.dueText}). Pay here: ${d.link}`;
}

export function absentAlertText(lang: Lang, d: { org: string; student: string; date: string }): string {
  return lang === 'hi'
    ? `नमस्ते! ${d.student} आज (${d.date}) ${d.org} में अनुपस्थित है। कृपया ध्यान दें।`
    : `Namaste! ${d.student} was absent at ${d.org} today (${d.date}).`;
}

export function receiptText(lang: Lang, d: { org: string; student: string; amount: number; receiptNo: string; balance: number }): string {
  const bal = d.balance > 0;
  return lang === 'hi'
    ? `${d.org}: ${d.student} की ${inr(d.amount)} फीस प्राप्त हुई। रसीद ${d.receiptNo}।${bal ? ` बाकी: ${inr(d.balance)}।` : ''} धन्यवाद!`
    : `${d.org}: received ${inr(d.amount)} for ${d.student}. Receipt ${d.receiptNo}.${bal ? ` Balance due: ${inr(d.balance)}.` : ''} Thank you!`;
}

export function staffInviteText(d: { org: string; name: string; link: string }): string {
  return `Hi ${d.name}, ${d.org} has added you on ClassKendra. Sign in with this mobile number: ${d.link}`;
}
