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
export type PlanCode = 'Trial' | 'Free'
  | 'TuitionLite' | 'Starter' | 'Growth' | 'Pro'
  | 'School100' | 'School200' | 'School300' | 'School500' | 'School1000'
  // old school plans: kept so schools already on them still load
  | 'School' | 'SchoolPlus' | 'SchoolMax';
export type UserRole = 'Owner' | 'Staff' | 'Teacher';

export interface AuthUser {
  id: string;
  phone: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  /** Teachers only: the batches/classes they can mark attendance for. Empty for Owner and Staff (they see all). */
  batchIds: string[];
  /** An app PIN is set (asked after 10 minutes away instead of an OTP). */
  hasPin?: boolean;
  /** Owner and office staff must set a PIN because the app shows fees; teachers may skip. */
  pinRequired?: boolean;
  /** Verified backup email: login codes can be sent here if the mobile number stops working. Null = none. */
  email?: string | null;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
  /** Sent after an OTP login (or the first PIN on a device): the key that lets this phone unlock with a PIN. */
  deviceToken?: string | null;
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
  /** Language of WhatsApp messages to parents. */
  messageLanguage: Lang;
  /** Printed on receipts. Empty until the owner fills it in. */
  address?: string;
  phone?: string;
  /** Current logo (GET /centre/logo/{logoId}); null = no logo. */
  logoId?: string | null;
  /** WhatsApp receipt to the parent after every payment (default on). */
  sendReceipts?: boolean;
  /** Absent alerts: every absence, only after 2 classes in a row, or off (default 'Every'). */
  absentAlerts?: AbsentAlertMode;
  /** WhatsApp admission confirmation to the parent when a student is added (default on). */
  sendAdmissionMessages?: boolean;
  /** Demo only (the API keeps these in its own tables): admission number style and the next number. */
  admissionNoStyle?: AdmissionNoStyle;
  admissionNextNumber?: number;
}

export type AbsentAlertMode = 'Every' | 'TwoDays' | 'Off';

export type Lang = 'en' | 'hi';

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
  /** Discounts this student gets. In SQL this is its own StudentConcessions table. */
  concessions: Concession[];
  /** "A-2026-0045", "1251" or the school's own register number. */
  admissionNo?: string | null;
  /** true = admitted through ClassKendra (admission fee, one-time fees, WhatsApp confirmation); false = was already studying here. */
  isNewAdmission?: boolean;
  /** Only in the reply to POST /students: was the WhatsApp admission confirmation sent? */
  admissionMessageSent?: boolean | null;
  /** Students who left (active = false): their last day, why, and whether fee reminders continue for what they owe. */
  leftOn?: string | null;
  leftReason?: LeftReason | null;
  leftNote?: string | null;
  remindAfterLeaving?: boolean;
}

export type LeftReason = 'Left' | 'Transferred' | 'PassedOut' | 'Removed';

/** One page of a long list. `total` = rows matching the filters, the same on every page. */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /students/page. newCount = new admissions this session among all matching students. */
export interface StudentPage extends Paged<Student> {
  newCount: number;
}

/** POST /students/{id}/leave */
export interface StudentLeaveRequest {
  /** Last day (yyyy-MM-dd). Not in the future. */
  leftOn: string;
  reason: LeftReason;
  note?: string;
  /** Keep = fees already raised are still owed. Waive = write off everything unpaid (needs waiveReason). */
  dues: 'Keep' | 'Waive';
  waiveReason?: string;
  /** With dues = Keep: keep sending WhatsApp fee reminders for what is still owed. */
  keepReminding?: boolean;
}

export interface StudentLeaveResult {
  student: Student;
  /** Bills for months after the leaving month, removed because they were never owed. */
  billsCancelled: number;
  stillOwed: number;
  waived: number;
}

/** GET /fees/page. The three totals cover every student matching the filters, not only this page. */
export interface FeesPage extends Paged<StudentFees> {
  pendingTotal: number;
  pendingCount: number;
  paidTotal: number;
}

/** A holiday for the whole centre (Settings › Holidays). */
export interface Holiday {
  id: string;
  name: string;
  from: string;
  to: string;
  days: number;
}

export type ActivityAction =
  | 'PaymentCancelled' | 'StudentLeft' | 'StudentRejoined' | 'FeesWaived'
  | 'HolidayAdded' | 'HolidayRemoved' | 'CheckInRadiusChanged'
  | 'Refunded' | 'ChargeAdded' | 'OpeningBalanceSet' | 'FeeSettingsChanged' | 'BatchChanged'
  | 'DataExported' | 'PromotionUndone' | 'PaymentRestored';

/** A promotion run (GET /students/promotions). canUndo: within 7 days and not undone yet. */
export interface PromotionRunView {
  id: string;
  createdAt: string;
  runBy: string;
  moved: number;
  left: number;
  keptBack: number;
  undoneAt: string | null;
  undoneBy: string | null;
  canUndo: boolean;
  /** Last day it can be undone (yyyy-MM-dd). */
  undoEndsOn: string | null;
}

export interface UndoPromotionResult {
  restored: number;
  /** Students left as they were, with why. */
  skipped: { studentId: string; name: string; reason: string }[];
  billsRemoved: number;
}

/** Student profile › Attendance (GET /students/{id}/attendance?month=). */
export interface StudentAttendance {
  /** First day counted this session (joined, moved to this class, or session start). */
  since: string;
  present: number;
  absent: number;
  /** null when no register has been marked yet. */
  percent: number | null;
  month: string;
  /** Every register of that month: Present or Absent. */
  days: { date: string; status: 'Present' | 'Absent' }[];
  /** Last 10 days absent this session, newest first. */
  recentAbsences: string[];
}

/** A fee that will be raised later this session (GET /students/{id}/fees/upcoming). */
export interface UpcomingFee {
  headName: string;
  periodLabel: string;
  month: string;
  dueDate: string;
  grossAmount: number;
  discount: number;
  amount: number;
}

/** Excel downloads (GET /exports/{kind}). */
export type ExportKind = 'students' | 'fees' | 'receipts' | 'refunds' | 'daybook';

/** One line in the activity log (GET /activity, owner only). */
export interface ActivityEntry {
  id: string;
  /** UTC ISO time. */
  at: string;
  userName: string;
  userRole: string;
  action: ActivityAction;
  entityType: 'Payment' | 'Student' | 'Holiday' | 'Settings';
  entityId: string | null;
  summary: string;
  reason: string | null;
}

export type ConcessionReason = 'Sibling' | 'Staff child' | 'Scholarship' | 'Other';

export interface Concession {
  id: string;
  reason: ConcessionReason;
  note: string;
  /** null = applies to every fee head. */
  feeHeadId: string | null;
  kind: 'Percent' | 'Amount';
  /** 10 = 10% (Percent) or ₹10 off each bill (Amount). */
  value: number;
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
  /** The admission fee: one-time, charged only to new admissions (at most one). */
  admissionFee?: boolean;
}

/** Settings → Admission numbers. "Session" = A-2026-0045, "Serial" = 1251, 1252… (the school's register). */
export type AdmissionNoStyle = 'Session' | 'Serial';
export interface AdmissionNumbering {
  style: AdmissionNoStyle;
  /** The number the next new student gets. */
  nextNumber: number;
  /** What the next number looks like: "A-2026-0047" or "1251". */
  example: string;
}

export interface FeeSettings {
  /** Day of the month a fee falls due (1–28). */
  dueDay: number;
  /** First month of the academic session (4 = April). Quarterly/term/yearly fees are counted from here. */
  sessionStartMonth: number;
  remindBefore: boolean;
  remindOnDue: boolean;
  remindAfter: boolean;
  /** Late fee: None, Once (a fixed fine) or PerDay. */
  lateFeeType?: LateFeeType;
  /** ₹ once, or ₹ per day. */
  lateFeeAmount?: number;
  /** Days after the due date before it starts (0 = from the day after). */
  lateFeeAfterDays?: number;
  /** PerDay only: the most per fee. 0 = no limit. */
  lateFeeMax?: number;
  /** Discount for the 2nd and later child of a family (same parent phone). */
  siblingDiscountType?: SiblingDiscountType;
  siblingDiscountValue?: number;
  /** null = every fee; otherwise only this fee. */
  siblingDiscountHeadId?: string | null;
}

export type LateFeeType = 'None' | 'Once' | 'PerDay';
export type SiblingDiscountType = 'None' | 'Percent' | 'Amount';

/** Bills ClassKendra makes itself: previous dues, late fees, extra charges. null = one of the centre's fees. */
export type BillKind = 'OpeningBalance' | 'LateFee' | 'Charge';

export type FeeStatus = 'Pending' | 'Partial' | 'Paid';
/** 'Opening' = advance paid before ClassKendra (opening balance); never counted as collection. */
export type PaymentMode = 'Cash' | 'UPI' | 'Cheque' | 'Online' | 'Opening';

/** One bill line: a fee head for a period. Money received is tracked in Payments, not here. */
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
  /** Fee before discount. */
  grossAmount: number;
  /** Concession applied when the bill was raised. */
  discount: number;
  /** What the parent owes for this line: grossAmount - discount. */
  amount: number;
  /** Sum of payment allocations against this line. */
  paidAmount: number;
  dueDate: string;
  status: FeeStatus;
  lastPaidOn: string | null;
  remindersSent: number;
}

export interface FeeDueView extends FeeDue {
  studentName: string;
  batchName: string;
  daysLate: number;
  /** amount - paidAmount */
  balance: number;
  /** Previous dues, late fee or an extra charge; missing for the centre's own fees. */
  kind?: BillKind | null;
}

/** Money received once, with one receipt. It can cover several dues, fully or in part. */
export interface Payment {
  id: string;
  /** "R-2026-0001": sequence per tenant per session. */
  receiptNo: string;
  studentId: string;
  amount: number;
  mode: PaymentMode;
  paidOn: string;
  note: string;
  receivedBy: string;
  allocations: { dueId: string; headName: string; periodLabel: string; amount: number }[];
}

export interface PaymentView extends Payment {
  studentName: string;
  batchName: string;
  parentPhone: string;
  /** What the student still owes after this payment. */
  balanceAfter: number;
  /** Everything printed on the receipt, frozen when the payment was recorded (missing in demo mode). */
  receipt?: ReceiptSnapshot;
  /** true = cancelled: it counts for nothing, and its money is back on the bills. The receipt number is never reused. */
  cancelled?: boolean;
  /** UTC ISO time. */
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  /** Other receipts paid at the same time (brothers and sisters paid together). */
  together?: { id: string; receiptNo: string; studentName: string; amount: number }[] | null;
}

/**
 * A receipt exactly as it was at payment time. The receipt page draws only from this,
 * so later changes to the centre or student never change an old receipt.
 */
export interface ReceiptSnapshot {
  /** Which receipt design to draw it with. Old receipts keep their number, so they always look the same. */
  layout: number;
  /** True for payments made before receipts were frozen: filled in when first opened. */
  rebuilt: boolean;
  capturedAt: string;
  centre: {
    name: string;
    city: string;
    address: string;
    phone: string;
    logoId: string | null;
    institutionType: InstitutionType;
  };
  student: { name: string; parentName: string; parentPhone: string; batchName: string };
  receiptNo: string;
  paidOn: string;
  amount: number;
  mode: PaymentMode;
  note: string;
  receivedBy: string;
  lines: { headName: string; periodLabel: string; amount: number }[];
  /** Online overpayment that went to no fee. */
  unallocated: number;
  balanceAfter: number;
}

export interface StudentFeeHistory {
  student: Student;
  batchName: string;
  dues: FeeDueView[];
  payments: PaymentView[];
  balance: number;
  paidThisSession: number;
  /** Public payment page for this family (the same link the WhatsApp reminder carries). */
  payLink: string;
  /** Money paid that isn't on any fee yet; used on the next fees automatically, or refunded. */
  advance?: number;
  refunds?: Refund[];
  /** Previous dues / advance from before ClassKendra. */
  opening?: OpeningBalance | null;
  /** Parts of fees waived and extra charges, newest first. */
  adjustments?: FeeAdjustment[];
  /** Brothers and sisters (same parent phone) still studying here or still owing. */
  siblingCount?: number;
}

export type RefundMode = 'Cash' | 'UPI' | 'Cheque' | 'Bank';

/** Money given back to a parent, out of the student's advance. */
export interface Refund {
  id: string;
  /** "RF-2026-0001" */
  refundNo: string;
  amount: number;
  mode: RefundMode;
  refundedOn: string;
  reason: string;
  by: string;
  createdAt: string;
}

export interface FeeAdjustment {
  id: string;
  dueId: string;
  kind: 'Waive' | 'Charge';
  amount: number;
  reason: string;
  by: string;
  createdAt: string;
}

/** What a student owed, or had paid ahead, before the centre started using ClassKendra. */
export interface OpeningBalance {
  previousDues: number;
  advancePaid: number;
  asOn: string | null;
  /** false once money was paid against the previous dues or the advance was used. */
  editable: boolean;
}

/** A brother or sister (same parent phone) and what they owe. */
export interface FamilyMember {
  studentId: string;
  name: string;
  batchName: string;
  active: boolean;
  dues: FeeDueView[];
  balance: number;
  advance: number;
}

/** POST /payments/family — one amount for brothers and sisters, spread over all ticked fees oldest first. */
export interface FamilyPaymentRequest {
  items: { studentId: string; dueIds: string[] }[];
  amount: number;
  mode: PaymentMode;
  paidOn: string;
  note: string;
}

export interface CollectionReport {
  month: string;
  collected: number;
  receiptCount: number;
  discountGiven: number;
  byMode: { mode: PaymentMode; amount: number; count: number }[];
  byGroup: { batchId: string; name: string; collected: number; pending: number }[];
  byHead: { headName: string; collected: number }[];
  payments: PaymentView[];
  /** Money given back to parents in the month. */
  refunded?: number;
  /** Parts of fees waived in the month (not concessions). */
  waived?: number;
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
  studentId: string;
  /** Dues the parent is paying for; the amount is spread over them, oldest first. */
  dueIds: string[];
  /** Can be less than the total (part payment), never more. */
  amount: number;
  mode: PaymentMode;
  paidOn: string;
  note: string;
  /** true = money beyond the ticked fees goes on other unpaid fees, then is kept as advance. */
  keepExtra?: boolean;
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
  /** Set when that day is a holiday: the register can still be saved, but no absent alerts go out. */
  holidayName?: string | null;
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
  /** Extra numbers for the wide (desktop) dashboard. Older APIs leave it out. */
  insights?: DashboardInsights | null;
}

/** Desktop dashboard extras, all for the logged-in centre. */
export interface DashboardInsights {
  /** Active students who joined this month. */
  newThisMonth: number;
  /** Still owed on bills whose due date has passed. */
  overdue: number;
  overdueCount: number;
  /** Share of this month's collections paid by UPI or online (0–100). */
  digitalSharePct: number;
  messagesThisMonth: number;
  /** Delivered or read, out of messages that left the outbox (0–100). */
  messagesDeliveredPct: number;
  messageLimit: number;
  /** Last 6 months, oldest first. Billed = bills raised that month; collected = receipts dated that month. */
  trend: { month: string; billed: number; collected: number }[];
  /** This month's bills per batch and how much of them is paid. */
  batches: { batchId: string; name: string; billed: number; collected: number }[];
  /** Latest receipts, newest first. `at` is the ISO timestamp it was recorded (UTC). */
  recentPayments: {
    id: string;
    receiptNo: string;
    studentName: string;
    batchName: string;
    amount: number;
    mode: PaymentMode;
    paidOn: string;
    at: string | null;
  }[];
  /** Batches that meet today, by start time. `present` is null until attendance is marked. */
  classesToday: {
    batchId: string;
    name: string;
    startTime: string | null;
    teacher: string | null;
    students: number;
    present: number | null;
  }[];
}

export interface Plan {
  code: Exclude<PlanCode, 'Trial'>;
  name: string;
  students: string;
  monthly: number;
  yearly: number;
  messages: number;
  popular?: boolean;
  /** Most students the plan allows (for the price per student). 0 or missing = no limit shown. */
  maxStudents?: number;
}

export interface StudentImportRow {
  name: string;
  parentPhone: string;
  batchName: string;
  /** Optional: the student's number in the school register. */
  admissionNo?: string;
  /** Optional: what the student owed before ClassKendra (₹). */
  previousDues?: number;
  /** Optional: what the parent had already paid ahead (₹). */
  advancePaid?: number;
}

/* ---------- Promotion to the next class ---------- */

export interface PromotionRequest {
  /** Every class/batch being moved. toBatchId null = leaving (passed out or left). */
  moves: { fromBatchId: string; toBatchId: string | null }[];
  /** Students who stay in their current class (held back). */
  keepBackStudentIds: string[];
}

export interface PromotionResult {
  moved: number;
  left: number;
  keptBack: number;
}

/* ---------- WhatsApp message log ---------- */

export type MessageType = 'FeeReminder' | 'AbsentAlert' | 'Receipt' | 'StaffInvite' | 'Admission' | 'LeaveRequest' | 'LeaveAnswer';
export type MessageStatus = 'Queued' | 'Sent' | 'Delivered' | 'Read' | 'Failed';

/** One row per WhatsApp message (the Notifications outbox). Status comes from the provider's delivery webhook. */
export interface MessageLog {
  id: string;
  studentId: string | null;
  recipientName: string;
  phone: string;
  type: MessageType;
  text: string;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageSummary {
  total: number;
  byStatus: Record<MessageStatus, number>;
}

/* ---------- Public parent payment page ---------- */

/** GET /public/pay/{token} — no login; the token identifies one student. */
export interface ParentPayPage {
  orgName: string;
  orgCity: string;
  studentName: string;
  batchName: string;
  dues: FeeDueView[];
  total: number;
  language: Lang;
  /** Each child on the page (brothers and sisters with the same parent phone). Dues carry their studentId. */
  children?: { studentId: string; name: string; batchName: string; balance: number }[];
}

/** POST /public/pay/{token}/order — the API creates a Razorpay order for the chosen dues. */
export interface ParentPayOrder {
  orderId: string;
  amount: number;
  /** Razorpay key id for Checkout; empty in demo mode. */
  keyId: string;
}

/** GET /dashboard/teacher — a teacher's home screen. Only their own batches; no money. */
export interface TeacherDashboard {
  batchCount: number;
  studentCount: number;
  /** Attendance this month and last month (0–100), null when nothing was marked. */
  monthPct: number | null;
  prevMonthPct: number | null;
  /** Registers saved this week (Mon–Sat) out of classes scheduled this week. */
  weekMarked: number;
  weekScheduled: number;
  /** Absent alerts sent to parents this week. */
  alertsThisWeek: number;
  /** Today's classes by start time. `present` and `markedAt` (HH:mm, India time) are null until marked. */
  classesToday: {
    batchId: string;
    name: string;
    startTime: string | null;
    endTime: string | null;
    days: string | null;
    students: number;
    present: number | null;
    markedAt: string | null;
    alerted: number;
  }[];
  /** Students who missed 3+ of their last 12 classes. `history`: oldest first, true = absent. */
  watch: {
    studentId: string;
    name: string;
    batchName: string;
    lastAbsent: string;
    missed: number;
    of: number;
    history: boolean[];
  }[];
  /** Each batch over the last 30 days. */
  batches: {
    batchId: string;
    name: string;
    students: number;
    pct: number | null;
    classes: { date: string; pct: number }[];
    lowest: { date: string; pct: number } | null;
  }[];
  /** This week's timetable (Mon–Sat), one row per batch. */
  week: {
    start: string;
    slots: {
      batchId: string;
      name: string;
      startTime: string | null;
      days: { date: string; scheduled: boolean; present: number | null; students: number }[];
    }[];
  };
}

// ---------------- Staff attendance (schools, School 200 and above) ----------------

/** Present, Late, Absent, Leave, Holiday, WeeklyOff, NotYet (today, school not over), Upcoming, None (before joining). */
export type StaffDayStatus = 'Present' | 'Late' | 'Absent' | 'Leave' | 'Holiday' | 'WeeklyOff' | 'NotYet' | 'Upcoming' | 'None';

export interface StaffAvailability {
  enabled: boolean;
  /** Why not: not a school, or a plan below School 200. */
  reason: 'NotSchool' | 'Plan' | null;
}

export interface StaffCounts {
  present: number;
  late: number;
  leave: number;
  absent: number;
}

export interface StaffDay {
  date: string;
  status: StaffDayStatus;
  /** ISO time (UTC) */
  checkInAt: string | null;
  checkOutAt: string | null;
  lateMinutes: number;
  markedByOwner: boolean;
  /** Holiday name */
  note: string | null;
}

/** The check-in card for a teacher or office staff member. */
export interface MyStaffToday {
  date: string;
  /** "07:30" — the person's own timing, or the school's */
  start: string;
  end: string;
  lateAfter: string;
  status: StaffDayStatus;
  holidayName: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  lateMinutes: number;
  markedByOwner: boolean;
  schoolLat: number | null;
  schoolLng: number | null;
  radius: number;
  month: StaffCounts;
}

export interface StaffMonth {
  month: string;
  days: StaffDay[];
  counts: StaffCounts;
}

export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected';
export interface LeaveRequest {
  id: string;
  userId: string;
  name: string;
  role: 'Teacher' | 'Staff';
  from: string;
  to: string;
  /** Working days in the range */
  days: number;
  reason: string;
  status: LeaveStatus;
  rejectReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** Owner's list only: approved leave days this session */
  takenThisSession: number | null;
}

export interface StaffTodayRow {
  userId: string;
  name: string;
  role: 'Teacher' | 'Staff';
  status: StaffDayStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  lateMinutes: number;
  markedByOwner: boolean;
  start: string;
  end: string;
}

export interface StaffToday {
  date: string;
  dayType: 'Working' | 'Holiday' | 'WeeklyOff';
  holidayName: string | null;
  start: string;
  end: string;
  rows: StaffTodayRow[];
}

export type StaffMarkStatus = 'Present' | 'Late' | 'Absent' | 'Leave' | 'Clear';

export interface StaffReportRow {
  userId: string;
  name: string;
  role: 'Teacher' | 'Staff';
  counts: StaffCounts;
  days: StaffDay[];
}

export interface StaffReport {
  month: string;
  from: string;
  to: string;
  workingDays: number;
  holidays: number;
  rows: StaffReportRow[];
}

export interface StaffHoliday {
  id: string;
  name: string;
  from: string;
  to: string;
}

export interface StaffTiming {
  userId: string;
  name: string;
  role: 'Teacher' | 'Staff';
  /** null = the school's timing */
  start: string | null;
  end: string | null;
}

export interface StaffAttendanceSettings {
  start: string;
  end: string;
  graceMinutes: number;
  latitude: number | null;
  longitude: number | null;
  radius: number;
  /** 0 = Sunday … 6 = Saturday */
  weeklyOff: number[];
  holidays: StaffHoliday[];
  staff: StaffTiming[];
  notifyLeaveRequests: boolean;
  notifyLeaveAnswers: boolean;
  leaveWhatsApp: boolean;
}
