/*
 * These interfaces are the API contract.
 * Mirror them as DTOs in the .NET API (ClassKendra.Application/Dtos) so the JSON matches exactly.
 * Dates travel as ISO strings: "2026-11-04". Months as "2026-11". Money as whole rupees.
 */

export type InstitutionType = 'Coaching' | 'School';
export type PlanCode = 'Trial' | 'Starter' | 'Growth' | 'Pro';
export type UserRole = 'Owner' | 'Staff';

export interface AuthUser {
  id: string;
  phone: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface Centre {
  id: string;
  name: string;
  ownerName: string;
  city: string;
  institutionType: InstitutionType;
  subjects: string[];
  sizeBand: string;
  plan: PlanCode;
  trialEndsOn: string;
  messagesUsed: number;
  messageLimit: number;
  setupComplete: boolean;
}

export interface Batch {
  id: string;
  name: string;
  days: string;
  startTime: string;
  endTime: string;
  monthlyFee: number | null;
}

export interface Student {
  id: string;
  name: string;
  parentName: string;
  parentPhone: string;
  batchId: string;
  joinedOn: string;
  active: boolean;
}

export type FeeStatus = 'Pending' | 'Paid';
export type PaymentMode = 'Cash' | 'UPI' | 'Online';

export interface FeeDue {
  id: string;
  studentId: string;
  batchId: string;
  month: string;
  amount: number;
  dueDate: string;
  status: FeeStatus;
  paidOn: string | null;
  paidAmount: number | null;
  mode: PaymentMode | null;
  remindersSent: number;
}

/** A due joined with the student's name and batch for list screens (what GET /fees returns). */
export interface FeeDueView extends FeeDue {
  studentName: string;
  batchName: string;
  daysLate: number;
}

export interface FeeSettings {
  dueDay: number;
  remindBefore: boolean;
  remindOnDue: boolean;
  remindAfter: boolean;
}

export interface RecordPaymentRequest {
  amount: number;
  mode: PaymentMode;
  paidOn: string;
}

export interface AttendanceSheet {
  batchId: string;
  date: string;
  absentStudentIds: string[];
  saved: boolean;
}

export interface DashboardSummary {
  month: string;
  collected: number;
  expected: number;
  pending: number;
  pendingCount: number;
  dueThisWeek: number;
  dueThisWeekCount: number;
  presentToday: number;
  markedToday: number;
  studentCount: number;
  feesConfigured: boolean;
  needsAttention: FeeDueView[];
}

export interface Plan {
  code: Exclude<PlanCode, 'Trial'>;
  name: string;
  students: string;
  monthly: number;
  yearly: number;
  messages: number;
  popular?: boolean;
}

export interface StudentImportRow {
  name: string;
  parentPhone: string;
  batchName: string;
}
