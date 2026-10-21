# Placement Management Portal

A college-centric **campus recruitment management system** connecting three user types:

| Role | Who | What they do |
| --- | --- | --- |
| **Student** | Final-year students | Complete a profile, discover eligible drives, apply, track status |
| **Company / Recruiter** | Visiting recruiters | Publish recruitment drives, review applicants, shortlist / select |
| **Admin** | Placement cell | Monitor students, companies, drives, applications and statistics |

Frontend built with **React + JavaScript + CSS + React Router** only.
No TypeScript, no Redux, no UI framework, no backend required to run it.

> **Important:** the data layer is **mock/demo data** stored in the browser.
> There is no Node.js/Express/MongoDB server in this repository yet — but the
> code is **structured so the backend can be plugged in** without rewriting the
> UI (see [`services/`](#13-what-is-mock-and-what-is-backend-ready)).

---

## 1. How to run the project

```bash
# 1. install dependencies (React, React Router, Vite)
npm install

# 2. start the development server
npm run dev
```

Then open the URL printed in the terminal (default <http://localhost:5173>).

Other scripts:

```bash
npm run build        # production build into dist/
npm run preview      # serve the production build
npm run verify:data  # checks that the demo data obeys the eligibility rules
```

### Demo logins

The login page has a **"demo accounts"** box — click **Use** to fill the form,
then press **Login**. You can also type them manually:

| Role | Email | Password |
| --- | --- | --- |
| Student | `aarav.sharma@student.edu` | `student123` |
| Company | `careers@technova.io` | `company123` |
| Admin | `admin@college.edu` | `admin123` |

The demo student **Aarav Sharma** (CSE, CGPA 8.1, skills: Java, React, SQL, Git,
Data Structures) is deliberately crafted so that some drives are eligible and
some are not — that is how the eligibility feature can be demonstrated.

**Reset demo data** in the sidebar restores the original mock records at any time.

---

## 2. Folder structure

```
placement-portal/
├── index.html                  # single HTML page Vite serves (has <div id="root">)
├── vite.config.js              # build tool config (also where the /api proxy goes later)
├── package.json
├── scripts/
│   └── verify-mock-data.mjs    # dev check: demo data must obey the eligibility rules
└── src/
    ├── main.jsx                # entry point -> mounts <App /> and imports the CSS
    ├── App.jsx                 # providers + the complete route table
    │
    ├── data/                   # ===== MOCK DATA ONLY (replaced by MongoDB) =====
    │   ├── mockStudents.js         # 12 students
    │   ├── mockCompanies.js        # 8 companies
    │   ├── mockDrives.js           # 10 recruitment drives
    │   ├── mockApplications.js     # 23 applications + status timelines
    │   ├── mockNotifications.js    # notification inbox rows
    │   └── mockAdmin.js            # placement-officer account
    │
    ├── services/               # ===== THE API SEAM (this is what changes) =====
    │   ├── localDatabase.js        # fake "backend": localStorage + simulated latency
    │   ├── authService.js          # login / register / logout / session
    │   ├── studentService.js       # profile, resume, notifications
    │   ├── driveService.js         # drives (get / create / close)
    │   ├── applicationService.js   # apply + status changes (shortlist/select/reject)
    │   └── adminService.js         # placement statistics
    │
    ├── utils/                  # ===== PURE LOGIC (no React) =====
    │   ├── eligibility.js          # ⭐ the eligibility engine (core feature)
    │   ├── selectors.js            # joins collections + dashboard statistics
    │   ├── profileCompletion.js    # "profile completion %" calculation
    │   └── format.js               # date / deadline / initials helpers
    │
    ├── context/                # ===== GLOBAL STATE (useState + useContext) =====
    │   ├── AuthContext.jsx         # who is logged in + their role
    │   ├── DataContext.jsx         # the five collections + all write actions
    │   └── ToastContext.jsx        # success / error notifications
    │
    ├── hooks/
    │   ├── useCurrentStudent.js    # logged-in user -> full student profile
    │   └── useCurrentCompany.js    # logged-in user -> full company record
    │
    ├── config/
    │   ├── navigation.js           # sidebar items, page titles, home routes
    │   └── constants.js            # branches, semesters, job types
    │
    ├── components/             # ===== REUSABLE UI COMPONENTS =====
    │   ├── DashboardLayout.jsx     # shell: sidebar + topbar + <Outlet />
    │   ├── Sidebar.jsx  Topbar.jsx
    │   ├── ProtectedRoute.jsx      # route guards (login + role)
    │   ├── DriveCard.jsx  StatusBadge.jsx  ProfileCard.jsx
    │   ├── EligibilityPanel.jsx    # renders the eligibility checks
    │   ├── StatusTimeline.jsx      # the application progress tracker
    │   ├── ApplyConfirmModal.jsx   # "Apply for ... ?" confirmation
    │   ├── DriveFormModal.jsx      # company "Create Drive" form
    │   ├── Modal.jsx  Button.jsx  Icon.jsx  Avatar.jsx  Progress.jsx
    │   ├── StatCard.jsx  SearchBar.jsx  FilterBar.jsx  PageHeader.jsx
    │   └── EmptyState.jsx  LoadingState.jsx  ToastStack.jsx
    │
    ├── pages/
    │   ├── Login.jsx  Register.jsx  NotFound.jsx
    │   ├── student/    StudentDashboard, StudentProfile, StudentDrives,
    │   │               DriveDetails, StudentApplications,
    │   │               ApplicationDetails, StudentNotifications
    │   ├── company/    CompanyDashboard, CompanyDrives, CompanyApplicants
    │   └── admin/      AdminDashboard, AdminStudents, AdminCompanies,
    │                   AdminDrives, AdminApplications, AdminStatistics
    │
    └── styles/
        ├── base.css        # design tokens (colours, radius, shadows) + reset
        ├── layout.css      # sidebar / topbar / grids / responsive rules
        ├── components.css  # buttons, cards, badges, forms, tables, modal, toast
        └── pages.css       # page-specific styles (auth, dashboards, drive cards)
```

---

## 3. The routes

| Route | Page | Access |
| --- | --- | --- |
| `/login` | Login with role selector | public |
| `/register` | Register as student or company | public |
| `/student/dashboard` | Student dashboard (welcome, stats, recommended drives, profile card) | student |
| `/student/profile` | Full profile + edit / save / cancel + resume upload | student |
| `/student/drives` | Drive listing with search + 6 filters | student |
| `/student/drives/:id` | Drive details + eligibility breakdown + Apply | student |
| `/student/applications` | Application tracker (table + status tabs) | student |
| `/student/applications/:id` | Application details + progress tracker + history | student |
| `/student/notifications` | Notification inbox | student |
| `/company/dashboard` | Recruiter KPIs, drives, recent applicants | company |
| `/company/drives` | Create / close recruitment drives | company |
| `/company/applicants` | Applicant table + shortlist / reject / select + profile modal | company |
| `/admin/dashboard` | Placement cell overview + funnel + branch stats | admin |
| `/admin/students` | All students + derived "placed" status | admin |
| `/admin/companies` | Registered recruiters | admin |
| `/admin/drives` | Every drive on campus | admin |
| `/admin/applications` | Monitor every application | admin |
| `/admin/statistics` | Branch-wise / company-wise placement analysis | admin |

Routes live in a single place: **`src/App.jsx`**.

---

## 4. The workflows the UI implements

### Student workflow (highest priority)

```
Register / Login
   -> Profile (CGPA, branch, skills, resume)
   -> Recruitment Drives (search + filters)
   -> Eligibility status computed from CGPA / branch / skills / deadline
   -> Apply  ->  confirmation modal  ->  "Application submitted successfully."
   -> My Applications  ->  status: Applied / Under Review / Shortlisted / Selected / Rejected
   -> Application Details  ->  progress tracker with dates and recruiter remarks
```

### Campus-wide workflow

```
Student Profile
   -> Company creates a Recruitment Drive (defines the rules)
   -> System checks Eligibility
   -> Eligible student applies
   -> Company reviews the application
   -> Shortlisted / Selected / Rejected  (student is notified)
   -> Admin monitors everything
```

---

## 5. The eligibility system (core feature)

**File: `src/utils/eligibility.js`** — the single place where eligibility is decided.
No React component contains a rule like `if (cgpa > 7.5)`; components only render
the result.

Every drive declares its own rules as **data**:

```js
{
  minimumCGPA: 7.5,
  branches: ['CSE', 'IT'],
  requiredSkills: ['Java'],
  skillMatchMode: 'all',      // 'all' -> needs every skill, 'any' -> one is enough
  deadline: '2026-10-15',
  status: 'Open'
}
```

`checkEligibility(student, drive)` returns:

```js
{
  eligible: false,
  reasons: ['CGPA is below the required minimum of 8.5.'],
  checks: [                       // one entry per rule, used by <EligibilityPanel />
    { label: 'Minimum CGPA', required: '8.5+', actual: '8.1', passed: false,
      detail: 'CGPA is below the required minimum.' },
    ...
  ]
}
```

**Live examples in the demo data (student Aarav: CGPA 8.1, CSE, Java/React/SQL/Git/DS):**

| Drive | Result | Reason |
| --- | --- | --- |
| TechNova — SDE (7.5+, CSE/IT, Java) | ✅ Eligible | every rule passes |
| Accenture — ASE (7.0+, CSE/IT, **all** Java/SQL/Spring Boot) | ❌ Not eligible | *Missing required skill: Spring Boot.* |
| Deloitte — Analyst (8.5+, CSE/IT/ECE) | ❌ Not eligible | *CGPA is below the required minimum of 8.5.* |
| TCS — Digital (Closed drive) | ❌ Not eligible | *This drive is no longer accepting applications.* |

A second demo student, **Riya Verma (CGPA 6.9, ENTC)**, exists in the mock data
to show the low-CGPA case.

**Why it is written this way:** when the backend is ready, the college can move
this exact function to the server (`GET /api/drives/:id/eligibility?studentId=`)
and only `services/driveService.js` changes. The UI does not change at all.

---

## 6. How the frontend data flow works

```
                 ┌─────────────────────────────────────────────┐
 mock JS files   │  services/*.js                              │
 (data/)  ────►  │  authService · driveService ·               │
                 │  applicationService · studentService        │
                 └──────────────┬──────────────────────────────┘
                                │  (today: a fake 320 ms "network" delay)
                                ▼
                 ┌─────────────────────────────────────────────┐
                 │  context/DataContext.jsx                    │
                 │  students · companies · drives ·            │
                 │  applications · notifications               │
                 │  + actions: applyToDrive, updateProfile,   │
                 │    createDrive, updateApplicationStatus…   │
                 └──────────────┬──────────────────────────────┘
                                │  collections + useState
                                ▼
                 ┌─────────────────────────────────────────────┐
                 │  utils/selectors.js + utils/eligibility.js  │
                 │  pure functions → numbers, lists, results   │
                 └──────────────┬──────────────────────────────┘
                                ▼
                 ┌─────────────────────────────────────────────┐
                 │  pages/  and  components/  (the JSX)        │
                 └─────────────────────────────────────────────┘
```

### Step by step: what happens when "Apply" is clicked

1. `DriveCard` / `DriveDetails` calls `onApply(drive)` → the page sets
   `confirmDrive` in state → `<ApplyConfirmModal />` opens with the student's
   name, branch, CGPA and the drive details.
2. The student presses **Confirm Application** → `handleConfirmApply()` runs.
3. DataContext calls `applicationService.applyToDrive({ studentId, driveId })`.
4. Inside the service (acting like the server) it:
   - checks the drive exists,
   - **refuses duplicates** ("You have already applied for this drive."),
   - **re-checks eligibility** server-side,
   - creates the application with `status: 'Applied'` + first timeline entry,
   - inserts a notification for the student.
5. DataContext reloads the collections, so every page is in sync.
6. `showToast('Application submitted successfully.', 'success')` shows the
   green notification, the button becomes a disabled **✓ Applied**, and the
   application appears in **My Applications**.

The same pattern is used for every write: *service call → refresh state → toast*.

### Route protection

`components/ProtectedRoute.jsx` wraps each role's routes:

- not logged in → redirected to `/login`;
- logged in as another role → redirected to your own dashboard
  (a student typing `/admin/dashboard` never gets in);
- already logged in and visiting `/login` → `RedirectIfAuthenticated` sends you
  to your dashboard.

---

## 7. Important components

| Component | Why it matters |
| --- | --- |
| `components/DashboardLayout.jsx` | The shared shell for every logged-in page (sidebar + topbar + `<Outlet />`) |
| `components/Sidebar.jsx` / `Topbar.jsx` | Role-based navigation, search, notification bell, user chip |
| `components/DriveCard.jsx` | Company, role, eligibility, deadline + Apply / ✓ Applied / Not Eligible button states |
| `components/EligibilityPanel.jsx` | Renders the rule-by-rule eligibility result (the core feature) |
| `components/StatusTimeline.jsx` | The Applied → Under Review → Shortlisted → Selected progress tracker |
| `components/ApplyConfirmModal.jsx` | The confirmation step that prevents accidental / duplicate applications |
| `components/DriveFormModal.jsx` | The company form that **defines** the eligibility rules |
| `components/StatusBadge.jsx` | One colour language for every status across all three roles |
| `components/Modal.jsx`, `Button.jsx`, `Icon.jsx` | Consistent UI primitives (Escape-to-close, loading spinner, inline SVG icons) |
| `components/LoadingState.jsx`, `EmptyState.jsx` | Loading and empty states (required for good UX) |
| `components/ProtectedRoute.jsx` | Authentication + role guarding |

---

## 8. The acceptance checklist

Every item can be demonstrated without editing any code:

| # | Step | Where |
| --- | --- | --- |
| 1 | Login as student | `/login` → Student → **Use** → Login |
| 2 | Open student dashboard | `/student/dashboard` |
| 3 | View profile | sidebar → **My Profile** (click **Edit Profile** to show the form) |
| 4 | View recruitment drives | sidebar → **Recruitment Drives** |
| 5 | Search / filter drives | type in the search box, or use Branch / CGPA / Skill / Status / Deadline |
| 6 | Open a drive | **View Details** on any card |
| 7 | See eligibility | green panel (TechNova) or red panel with the exact reason (Accenture, Deloitte) |
| 8 | Apply | **Apply Now** → confirmation modal → **Confirm Application** |
| 9 | See the success message | green toast "Application submitted successfully." |
| 10 | Open My Applications | sidebar → **My Applications** (the new row says **Applied**) |
| 11 | See application status | click **Track** → progress tracker with dates |
| 12 | Log out | sidebar → **Logout** |
| 13 | Login as company | `/login` → Company → **Use** → Login |
| 14 | View company dashboard | `/company/dashboard` (KPIs, drives, recent applicants) |
| 15 | Create / view a recruitment drive | **Create Drive** → fill the form → **Publish Drive** |
| 16 | View applicants | `/company/applicants` → **View Profile**, **Shortlist**, **Reject**, **Mark Selected** |
| 17 | Login as admin | `/login` → Admin → **Use** → Login |
| 18 | View admin dashboard | `/admin/dashboard`, then `/admin/statistics` |

### The killer demo (proves it is ONE connected application)

1. As the student, apply to **TechNova — Software Development Engineer**.
2. Log out and log in as **Company** (`careers@technova.io`).
3. On the recruiter dashboard, press **Shortlist** on *Aarav Sharma*.
4. Log out and log back in as the student: the application now shows
   **Shortlisted**, the tracker has a new dated step with the recruiter remark,
   and the bell shows an unread notification.

That round trip is the whole project in four clicks.

---

## 9. Which files should I understand for the viva?

Read them in this order — they build on each other:

| Priority | File | What to be able to explain |
| --- | --- | --- |
| 1 | `src/App.jsx` | What a component is; how routing works; layout routes + `<Outlet />`; providers |
| 2 | `src/pages/Login.jsx` | Role-based routing after login; controlled inputs; local validation |
| 3 | `src/context/AuthContext.jsx` | Global state with `useState` + `useContext`; why Not Redux |
| 4 | `src/context/DataContext.jsx` | The single owner of the collections; read-then-refresh-after-write pattern |
| 5 | `src/utils/eligibility.js` | The core business rule; why it is a separate pure module |
| 6 | `src/pages/student/StudentDrives.jsx` | Controlled filters; **derived** state (never store the filtered list) |
| 7 | `src/pages/student/DriveDetails.jsx` | `useParams`; eligibility panel; the Apply CTA states |
| 8 | `src/services/applicationService.js` | Duplicate protection + server-side re-validation; status timeline; notifications |
| 9 | `src/components/StatusTimeline.jsx` | Rendering `statusHistory`; Rejected leaves the pipeline |
| 10 | `src/utils/selectors.js` | Joining collections (frontend "aggregation"); dashboard stats |
| 11 | `src/components/ProtectedRoute.jsx` | `Navigate` guards by login and role |
| 12 | `src/services/authService.js` | Why this is **not** real security, and what the real API will be |

### Likely viva questions and short answers

- **What is React?** A JavaScript library for building user interfaces from
  reusable **components**. It keeps the page in sync with state: when state
  changes, React re-renders only what is affected.
- **What is a component?** A JavaScript function that returns JSX (HTML-like
  syntax) and can hold state and receive props. Example: `DriveCard` receives a
  `drive` prop and returns one card's markup.
- **How does routing work?** `BrowserRouter` wraps the app; `<Routes>` matches
  the URL to a `<Route>`; `<Link>` / `useNavigate()` change the URL without a
  page reload; `useParams()` reads `:driveId` from the URL.
- **How is state managed?** Local UI state with `useState`; shared state with
  `useContext` (AuthContext, DataContext, ToastContext). No Redux because there
  is a single owner of the data and the data set is small.
- **How does the frontend talk to APIs?** It doesn't yet — `services/*.js`
  return mock promises. Each function documents the REST endpoint it will call,
  so connecting the backend is a change inside `services/` only.
- **What happens when Apply is clicked?** See §6 above.
- **How is eligibility displayed?** `checkEligibility()` returns a `checks`
  array; `EligibilityPanel` renders one row per rule with required vs actual
  values and a pass/fail marker.
- **How is application status updated?** The recruiter's action calls
  `applicationService.updateApplicationStatus()`, which sets `status`, updates
  `lastUpdated`, appends to `statusHistory` and creates a student notification.
- **Why REST APIs?** They give a clean separation between client and server:
  the frontend only knows URLs and JSON, so the UI can be hosted anywhere and
  the database can change without touching the frontend. REST also makes the
  contract explicit (`GET /api/drives`), which is easy to test with Postman.

---

## 10. Mock / demo parts vs backend-ready parts

### These parts are DEMO ONLY (deleted or replaced when the backend arrives)

| What | Where | Note |
| --- | --- | --- |
| All sample records | `src/data/mock*.js` | 12 students, 8 companies, 10 drives, 23 applications |
| The fake database + fake latency | `src/services/localDatabase.js` | Uses `localStorage` key `placement-portal-db-v1` |
| Authentication | `src/services/authService.js` | Passwords compared **in the browser**; no hashing, no JWT. A real server must never send passwords to the client |
| Resume "upload" | `studentService.uploadResume()` | Only the file name/size is stored; real version needs `multipart/form-data` (multer) |
| Resume "View / Download" | `StudentProfile.jsx` | Shows an explanatory toast — there is no stored file to download |
| "Forgot password" | `Login.jsx` | Shows a placeholder note instead of sending an email |
| Login "Keep me signed in" | `Login.jsx` | Cosmetic checkbox in the demo |
| Admin "verified" company flag | `mockCompanies.js` | Static demo value |
| `Reset demo data` button | `Sidebar.jsx` | Demo helper that clears `localStorage` |

### These parts are BACKEND-READY (no UI change needed)

- **`services/*.js`** — every function maps 1:1 to a REST endpoint (below).
  Replace the body of each function with a `fetch` and the pages keep working.
- **`utils/eligibility.js`** — pure function, works identically on the server.
- **`utils/selectors.js`** — the shapes match what MongoDB aggregations return.
- **`context/DataContext.jsx`** — already written as *load → render → write →
  reload*, the standard pattern for a remote API.
- **`ProtectedRoute.jsx`** — swap the context check for a token check.
- **`vite.config.js`** — there is a commented `proxy` block ready for
  `'/api' -> http://localhost:5000`.

### The REST API the services expect

| Service call | Endpoint | Method |
| --- | --- | --- |
| `authService.login` | `/api/auth/login` | POST |
| `authService.register` | `/api/auth/register` | POST |
| `authService.logout` | `/api/auth/logout` | POST |
| `authService.fetchCurrentUser` | `/api/auth/me` | GET |
| `studentService.getStudents` | `/api/students` | GET |
| `studentService.getStudentById` | `/api/students/:id` | GET |
| `studentService.updateStudentProfile` | `/api/students/profile` | PUT |
| `studentService.uploadResume` | `/api/students/resume` | POST (multipart) |
| `studentService.getNotifications` | `/api/notifications?studentId=` | GET |
| `studentService.markNotificationRead` | `/api/notifications/:id` | PATCH |
| `driveService.getDrives` | `/api/drives` | GET |
| `driveService.getDriveById` | `/api/drives/:id` | GET |
| `driveService.getDrivesByCompany` | `/api/companies/:id/drives` | GET |
| `driveService.createDrive` | `/api/drives` | POST |
| `driveService.closeDrive` | `/api/drives/:id` | PATCH |
| `applicationService.getApplications` | `/api/applications` | GET |
| `applicationService.getApplicationById` | `/api/applications/:id` | GET |
| `applicationService.getApplicationsByStudent` | `/api/students/:id/applications` | GET |
| `applicationService.getApplicationsByDrive` | `/api/drives/:id/applications` | GET |
| `applicationService.applyToDrive` | `/api/applications` | POST |
| `applicationService.updateApplicationStatus` | `/api/applications/:id` | PATCH |
| `adminService.getStatistics` | `/api/admin/statistics` | GET |

**Suggested MongoDB collections:** `students`, `companies`, `drives`,
`applications`, `notifications`, `users` (with a `role` field).
Passwords must be hashed with `bcrypt` and the server should return a **JWT**
instead of a user object with a password.

---

## 11. UX features implemented

- Loading states while data loads (`LoadingState`, `CardSkeleton`, button spinners)
- Empty states with a helpful next action (`EmptyState`) on every list
- Error states (failed login/register, not-found drive, not-found application)
- Success / error toasts for every write (`ToastContext` + `ToastStack`)
- Form validation on login, register, profile, resume upload and create-drive
- Confirmation modal before applying
- Duplicate applications are prevented (`✓ Applied` disabled button + service check)
- Clear eligible / not-eligible indicators everywhere (color + icon + reason text)
- Responsive: desktop → laptop → tablet → mobile (sidebar collapses to an
  off-canvas drawer, tables scroll horizontally, grids collapse to one column)
- Accessible touches: keyboard focus rings, `aria-*` labels, Escape closes modals

---

## 12. Known limitations (be honest about these in the viva)

1. No real authentication — the password lives in the mock data and is compared
   in the browser. There is no token validation, session expiry or encryption.
2. No persistence server-side — data is kept in `localStorage`, so it is
   per-browser. Clearing browser storage (or **Reset demo data**) reverts it.
3. File uploads are metadata only.
4. Company/admin screens are intentionally lighter than the student screens, as
   the student workflow is the focus of the project.
