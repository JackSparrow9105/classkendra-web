# ClassKendra — Angular web app

Mobile-first front end for ClassKendra: fees, attendance and WhatsApp parent reminders for **coaching centres and schools**.
Angular 22 · standalone components · signals · reactive forms · SCSS · no UI library.

It runs fully on its own today using an in-memory mock of the API, so every screen works before the .NET backend exists.

## Run it

```bash
npm install
npm start          # http://localhost:4200
```

Demo login: any 10-digit mobile number starting 6–9, then OTP **123456**.
In setup, pick **Coaching or tuition centre** or **School**.
On the empty dashboard, tap **"Just exploring? Fill with sample data"** to see a busy centre or school.
To try a teacher login: as the owner add a teacher under Settings › Staff and teachers, sign out, and sign in with the teacher's number.
Settings › **Reset demo data** starts again from sign-up.

Production build: `npm run build` (output in `dist/classkendra-web/browser`).

## Coaching and schools in one app

| | Coaching centre | School |
|---|---|---|
| Groups | Batches (name, days, timing) | Classes with sections ("Class 8 · A") |
| Fees | Fee heads; usually one monthly tuition fee per batch | Several heads: tuition per class, transport (opt-in), annual, exam… |
| Who signs in | Owner, office staff, teachers | Same |

All wording that differs ("Batch" / "Class", "Centre" / "School") lives in `src/app/core/labels.ts`.

### Fee heads and when they fall due (`src/app/core/fees/schedule.ts`)

| Frequency | Raised in |
|---|---|
| Monthly | every month |
| Quarterly | session start, +3, +6, +9 months (April session: Apr, Jul, Oct, Jan) |
| Term-wise (2 terms) | session start and +6 months |
| Yearly | session start, or the joining month for mid-session admissions |
| One-time | only the month a student joins (admission fee) |

"Opted in" heads (transport) are charged only to students ticked on their profile. The API's nightly due job must follow the same rules.

### Discounts, part payments and receipts

- **Concessions** (`core/fees/concessions.ts`): per student, reason (sibling, staff child, scholarship, other), % or fixed ₹ per bill, for one fee head or all. Applied when a bill is raised; each bill stores `grossAmount`, `discount` and `amount` (net). Adding or removing a concession re-prices that student's bills that have no money against them yet. A 100% concession raises no bill.
- **Payments**: money received is a `Payment` with a receipt number (`R-2026-0001`, running per session) and allocations to bills, applied oldest first. A bill is `Pending`, `Partial` or `Paid`. Never store "paid" only on the bill: the Payments and PaymentAllocations tables are the record.
- **Receipts**: `/receipts/:id`, printable (browser print or save as PDF) and shareable on WhatsApp.
- **Collection report**: `/reports`; collected = money received in the month (by receipt date), pending = balance still owed on bills up to that month. Excel has Summary, By class/batch and Receipts sheets.

### Roles

| | Owner | Office staff | Teacher |
|---|---|---|---|
| Dashboard, fees, students, setup | ✓ | ✓ | — |
| Attendance | all groups | all groups | own classes only |
| Students list | ✓ | ✓ | own classes, read-only |
| Staff, plans and billing | ✓ | — | — |

The API must enforce these too (filter by the teacher's `batchIds`); the UI hiding a button is not security.

## What's in it

| Screen | Route | Notes |
|---|---|---|
| Sign in | `/login`, `/otp` | Mobile number + OTP, no password |
| Setup (2 steps) | `/setup/centre`, `/setup/batches` | Coaching or school, details, then batches or classes with sections |
| Dashboard | `/dashboard` | "Finish setting up" checklist until students and fees exist, then collected / pending / late fees; trial badge |
| Students | `/students`, `/students/new`, `/students/:id` | Search, batch filter, "Save and add another", contact picker on Android |
| Add students other ways | `/students/import` | One by one (default), CSV upload, or "send us your register" on WhatsApp |
| Fee setup | `/fees/setup` | Fee heads (frequency, everyone or opted-in, amount per batch/class), due day, session start, reminders, message preview |
| Fees | `/fees` | One row per student; Pending / Paid / All, month, class filter; tick which heads were paid; "Remind all" |
| Student page | `/students/:id` | Balance, discounts, every fee this session, receipts; record payment or remind |
| Receipt | `/receipts/:id` | Printable receipt with receipt number; share on WhatsApp |
| Collection report | `/reports` | Month totals by mode, fee and class, receipt list, Excel download |
| Staff | `/staff` | Add office staff or teachers (with their classes); they sign in with their own number |
| Attendance | `/attendance` | Everyone present by default, tap absentees, save alerts parents |
| Plans | `/plans` | Trial status, message usage, monthly/yearly plans |
| Settings | `/settings` | Centre details, batches, fees, plans, sign out |

Phone: bottom navigation. 960px and wider: side navigation.

## Folder structure

```
src/app/
  core/
    models/models.ts        ← the API contract (mirror these as DTOs in .NET)
    services/               ← one service per API area; each method documents its endpoint
    mock/mock-db.ts         ← in-memory API stand-in (delete when the backend is done)
    guards/guards.ts        ← signed in, has a centre, owner-only
    interceptors/           ← adds the JWT, handles 401, readable error messages
  layout/shell.*            ← bottom nav (phone) / side nav (desktop)
  features/                 ← one folder per area: auth, setup, dashboard, students, fees, attendance, plans, settings
  shared/                   ← icon, toast, bottom sheet, formatting helpers
src/styles.scss             ← the theme: colours, type, buttons, inputs, cards
src/environments/environment.ts  ← useMock + apiUrl
```

## Connecting the .NET API

1. In `src/environments/environment.ts` set `apiUrl` to your API (e.g. `https://localhost:7001/api/v1`) and `useMock: false`.
2. Every service already has the real call next to the mock, for example:

   ```ts
   /** GET /students?batchId=&search= */
   list(filter) {
     if (!environment.useMock) return this.api.get<Student[]>('students', filter);
     ...mock...
   }
   ```
   You can switch one area at a time by changing the condition in that service while the rest stays on the mock.
3. Return JSON in the shapes from `core/models/models.ts` (camelCase, dates as `yyyy-MM-dd`, months as `yyyy-MM`, money in whole rupees).
4. Errors: return `{ "message": "..." }` with a 4xx status; the app shows that sentence to the user.
5. Enable CORS for `http://localhost:4200` in the API during development.

### Endpoints the app calls

| Method | Path | Used by |
|---|---|---|
| POST | `/auth/otp` | login — send OTP |
| POST | `/auth/verify` | OTP — returns `{ token, user }` (user.tenantId is null for a new owner) |
| GET / POST / PUT | `/centre` | setup step 1, settings |
| PUT | `/centre/setup-complete` | end of setup |
| GET / POST | `/batches` · PUT / DELETE `/batches/{id}` | batches and school class-sections (teachers get only theirs) |
| GET / POST | `/students` · GET / PUT / DELETE `/students/{id}` | students (DELETE = soft delete) |
| POST | `/students/import` | import (server should accept .xlsx as multipart) |
| GET / PUT | `/fees/setup` | `{ settings, heads }` — heads not in the PUT are deleted, their unpaid dues cancelled |
| GET | `/fees?month=&status=&search=&batchId=` | one `StudentFees` row per student (Pending includes older unpaid months) |
| POST | `/fees/remind` `{ studentIds }` · `/fees/remind-all?month=` | one WhatsApp per family listing what's unpaid → Notifications outbox |
| POST | `/payments` `{ studentId, dueIds, amount, mode, paidOn, note }` | record a full or part payment; returns the receipt (`PaymentView`) |
| GET | `/payments/{id}` | one receipt |
| GET | `/students/{id}/fees` | student fee history: bills, receipts, balance |
| POST / DELETE | `/students/{id}/concessions` · `/students/{id}/concessions/{cid}` | add or remove a discount |
| GET | `/reports/collection?month=` · `/reports/collection.xlsx?month=` | collection report and its Excel file (build with ClosedXML) |
| GET / POST | `/staff` · PUT / DELETE `/staff/{id}` | office staff and teachers |
| GET / POST | `/attendance/{batchId}?date=` | attendance (save alerts only newly absent students) |
| GET | `/dashboard` | dashboard summary |
| GET | `/billing/plans` · POST `/billing/checkout` | plans |

## Before going live

- Remove `core/mock` and the demo-only bits (sample data button, reset demo data, OTP hint).
- School plan prices in `core/services/billing.service.ts` (mock) are placeholders: confirm them with your first schools and serve real ones from the API.
- Replace `SUPPORT_WHATSAPP` in `features/students/student-import.ts` with your number.
- Add the Angular service worker (`ng add @angular/pwa`) so owners can install it on their phone.
