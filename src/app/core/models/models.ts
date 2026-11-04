/*
 * These interfaces are the API contract.
 * Mirror them as DTOs in the .NET API (ClassKendra.Application/Dtos) so the JSON matches exactly.
 * Dates travel as ISO strings: "2026-11-04". Months as "2026-11". Money as whole rupees.
 *
 * One model serves both coaching centres and schools:
 *  - a Batch is a coaching batch OR a school class-section ("Class 8 · A")
 *  - fees are FeeHeads (coaching usually has one monthly head; schools have tuition, transport, annual...)
 */

export type InstitutionType = 'Coaching' | 'School';
export type PlanCode = 'Trial' | 'Starter' | 'Growth' | 'Pro' | 'School' | 'SchoolPlus' | 'SchoolMax';
export type UserRole = 'Owner' | 'Staff' | 'Teacher';

export interface AuthUser {
  id: string;
  phone: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  /** Teachers only: the batches/classes they can mark attendance for. Empty for Owner and Staff (they see all). */
  batchIds: string[];
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
  /** Display name: "Class 10 · Maths" (coaching) or "Class 8 · A" (school). */
  name: string;
  /** Schools only: "Nursery", "LKG", "1" … "12". */
  className: string | null;
  /** Schools only: "A", "B" … */
  section: string | null;
  /** Coaching only (schools run on the school day). */
  days: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface Student {
  id: string;
  name: string;
  parentName: string;
  parentPhone: string;
  batchId: string;
  joinedOn: string;
  active: boolean;
  /** Optional fee heads this student has opted into, e.g. school transport. */
  optionalHeadIds: string[];
}

export type FeeFrequency = 'Monthly' | 'Quarterly' | 'HalfYearly' | 'Yearly' | 'OneTime';

export interface FeeHead {
  id: string;
  /** "Tuition fee", "Transport", "Annual fee"… */
  name: string;
  frequency: FeeFrequency;
  /** true = only students who opt in pay it (transport). false = everyone in the batch/class pays. */
  optional: boolean;
  /** batchId -> amount in rupees. A batch with no amount (or 0) is not charged this head. */
  amounts: Record<string, number>;
}

export interface FeeSettings {
  /** Day of the month a fee falls due (1–28). */
  dueDay: number;
  /** First month of the academic session (4 = April). Quarterly/term/yearly fees are counted from here. */
  sessionStartMonth: number;
  remindBefore: boolean;
  remindOnDue: boolean;
  remindAfter: boolean;
}

export type FeeStatus = 'Pending' | 'Paid';
export type PaymentMode = 'Cash' | 'UPI' | 'Online';

export interface FeeDue {
  id: string;
  studentId: string;
  batchId: string;
  feeHeadId: string;
  headName: string;
  /** Unique per head per student: "2026-11", "2026-Q3", "2026-T2", "2026-Y", "OT". */
  period: string;
  /** Human label: "Nov 2026", "Q3 · Oct–Dec", "Term 2", "2026–27", "One-time". */
  periodLabel: string;
  /** The month this due was raised in (YYYY-MM); used to filter by month. */
  month: string;
  amount: number;
  dueDate: string;
  status: FeeStatus;
  paidOn: string | null;
  paidAmount: number | null;
  mode: PaymentMode | null;
  remindersSent: number;
}

export interface FeeDueView extends FeeDue {
  studentName: string;
  batchName: string;
  daysLate: number;
}

/** One row per student on the Fees screen (what GET /fees returns). */
export interface StudentFees {
  studentId: string;
  studentName: string;
  batchId: string;
  batchName: string;
  dues: FeeDueView[];
  pending: number;
  paid: number;
  maxDaysLate: number;
  nextDueDate: string | null;
}

export interface FeeSetupRequest {
  settings: FeeSettings;
  /** Full list of heads; new heads have id "". Heads left out are deleted (their unpaid dues are cancelled). */
  heads: FeeHead[];
}

export interface RecordPaymentRequest {
  dueIds: string[];
  mode: PaymentMode;
  paidOn: string;
}

export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  role: Exclude<UserRole, 'Owner'>;
  batchIds: string[];
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
  /** Students with late fees, most overdue first. */
  needsAttention: StudentFees[];
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
