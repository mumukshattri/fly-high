# JOB N JOB — Campus Placement Management Portal

A full-stack placement portal for a college placement cell. Three roles share one
database: **students** discover eligible drives and track every application,
**recruiters** publish drives and move candidates through the hiring pipeline,
and the **placement cell** verifies companies and monitors the whole season.

Nothing is mocked. Every screen reads and writes the Express API, and every
record lives in MongoDB. There is no SQLite fallback, no `localStorage` store and
no in-memory demo data.

---

## Stack

| Layer    | Choice                                                    |
| -------- | --------------------------------------------------------- |
| Frontend | React 19 + React Router 7, built with Vite 8               |
| Backend  | Express 5                                                 |
| Database | MongoDB via Mongoose 8                                    |
| Auth     | Server-side sessions in MongoDB, HttpOnly cookie          |
| Realtime | Server-Sent Events on `/api/realtime/events`              |
| External jobs | Adzuna Job Search API, proxied by the Express server |

Node **22 LTS or newer** is required (`process.loadEnvFile`).

---

## Setup

```bash
npm install

cp .env.example .env          # then edit MONGODB_URI if needed
# MONGODB_URI=mongodb://127.0.0.1:27017/jobnjob

npm run server                # API on http://127.0.0.1:5000
npm run dev                   # Vite dev server on http://localhost:5173 (proxies /api)
```

Open <http://localhost:5173>. Start both processes for development; `npm run dev`
only starts Vite.

### Create the first administrator

Admin accounts are deliberately **not** self-registrable — an admin can read
every student record, so the account is created out of band:

```bash
npm run admin:create -- --email admin@college.edu --name "Placement Officer"
```

The password is generated and printed once, or passed with `--password` /
`--password-file`. `--force` resets the password of an existing admin.

Students and recruiters register themselves at `/register`.

### Single-process production run

```bash
npm run build && npm start    # Express serves the built SPA and the API on :5000
```

---

## Scripts

| Script              | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Vite dev server with `/api` proxy                     |
| `npm run dev:api`   | API with `--watch`                                    |
| `npm run server`    | API, no watch                                         |
| `npm run build`     | Production frontend build into `dist/`                |
| `npm start`         | Serve `dist/` + API from one process                  |
| `npm test`          | Integration tests against a throwaway MongoDB         |
| `npm run admin:create` | Create or update an administrator account          |

---

## How it works

### Authentication

- `POST /api/auth/register` and `/auth/login` create a session row in MongoDB and
  set `jnj_session` as an **HttpOnly, SameSite=Lax** cookie (`Secure` in
  production). No token is ever written to `localStorage`.
- Only a SHA-256 hash of the session token is stored server-side, with a 7-day TTL
  index. Logout deletes the row, so a copied cookie stops working immediately.
- `GET /api/auth/me` restores the session on page load. `ProtectedRoute` and
  `DataContext` send the user to `/login` on any `401`.

### Roles and the verification gate

| Role    | Can do                                                                 |
| ------- | ---------------------------------------------------------------------- |
| Student | Browse drives, apply (eligibility enforced server-side), track status  |
| Company | Publish drives **once verified**, review and shortlist applicants      |
| Admin   | Verify companies, view every record, placement statistics, export      |

A newly registered company has `verified: false` and `POST /api/drives` returns
`403` until an admin flips the flag on **Admin → Companies** (`Verify company` /
`Revoke verification`).

### Eligibility

`src/utils/eligibility.js` is shared by the backend and the UI. CGPA, branch,
skills and an open deadline are checked before an application is accepted; the
API returns the reasons, and the drives page shows them before the student even
tries. The client-side check is a convenience — the server is authoritative.

### Realtime

`GET /api/realtime/events` is an authenticated SSE stream. Mutations broadcast a
resource name (`applications`, `notifications`, `drives`, `companies`,
`students`). `DataContext` debounces a refetch, so a recruiter shortlisting a
candidate updates the student's open page within a second, with no reload.

### Pipeline

`Applied → Under Review → Shortlisted → Selected`, plus `Rejected`, defined once
in `src/config/pipeline.js` and mirrored by the API. Every transition is appended
to `statusHistory` and creates a notification for the student.

### External job discovery (Adzuna)

Students can also search vacancies from employers that are **not** registered on
the portal. Those listings come live from the [Adzuna API](https://developer.adzuna.com/)
and are never copied into MongoDB, never turned into a `Drive` and never create an
`Application` — the student applies on the employer's own site through the
`redirect_url` the provider returns.

```bash
# .env  (both values are server-only secrets - never committed, never sent to a browser)
ADZUNA_APP_ID=your-app-id
ADZUNA_APP_KEY=your-app-key
ADZUNA_COUNTRY=in            # optional, default India
```

Get a free key at <https://developer.adzuna.com/signup>. Without it the portal
works exactly as before; the section simply reports that it is not configured
instead of showing invented vacancies.

| Endpoint                          | Purpose                                             |
| --------------------------------- | --------------------------------------------------- |
| `GET /api/external-jobs`          | Search: `what`, `where`, `category`, `page`, `resultsPerPage` (1–50), `maxDaysOld`, `sortBy` |
| `GET /api/external-jobs/categories` | Adzuna's own category list for the configured country |
| `GET /api/external-jobs/status`   | Whether the server has credentials (names only)     |

All three require a signed-in **student** session. Behaviour worth knowing:

- **Normalisation** — `server/external-jobs.js` maps Adzuna's payload onto a fixed
  shape (`title`, `company`, `location`, `description`, `salary`, `employmentType`,
  `postedAt`, `url`, `source`). A field the provider did not send is `null` in the
  API and hidden in the UI; nothing is defaulted.
- **Caching** — identical searches are served from a 10-minute in-memory cache
  (categories for 24 h) because the free tier allows roughly 250 calls a day.
- **Throttling** — 20 searches per minute per student, on top of the cache.
- **Failures** — a timeout returns `504`, a rejected key `502` (`provider_auth`),
  rate limiting `429`, missing configuration `503` (`not_configured`). The student
  dashboard renders those as a small inline notice, so an Adzuna outage cannot
  break campus drives, applications or notifications.
- **Safety** — only `http(s)` URLs are accepted from the provider, `**` highlight
  markers and HTML are stripped from titles and descriptions, and the API key is
  never included in a response, a log line or an error message.

---

## Project layout

```
server/                 Express API (no build step, plain ESM)
  index.js              entry point: connect DB, then listen
  app.js                createApp() factory (used by the tests)
  api.js                all routes
  auth.js               sessions, cookies, requireAuth(roles)
  events.js             SSE fan-out
  external-jobs.js      Adzuna proxy: validation, normalisation, cache, throttle
  models/               Mongoose schemas
  provision-admin.js    npm run admin:create
src/
  services/             one module per resource; the only place that calls fetch
  context/              AuthContext, DataContext (role-scoped loading), toasts
  pages/                student/, company/, admin/ screens
  pages/student/ExternalJobs.jsx   "Discover External Opportunities"
  components/           shared UI
  config/pipeline.js    statuses and pipeline stages
  utils/                eligibility rules, selectors, formatting
tests/api.test.js       integration tests (real HTTP + real MongoDB)
```

---

## Tests

```bash
npm test
# or point at another server:
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/jobnjob_test npm test
```

The suite boots `createApp()` on an ephemeral port against a throwaway database
(`jobnjob_test`, dropped at the start of each run) and drives it over HTTP with
separate cookie jars per account. It covers: health, anonymous `401`s, HttpOnly
cookie shape, duplicate email `409`, wrong password/role `401`, the unverified
company gate, ineligible-student `403` with reasons, duplicate application `409`,
cross-company isolation, notification creation, live SSE delivery, and session
revocation on logout. MongoDB must be running; the suite fails loudly if it is
not.

---

## Troubleshooting

| Symptom                                    | Cause                                                  |
| ------------------------------------------ | ------------------------------------------------------ |
| `MONGODB_URI is not set`                   | No `.env`; copy `.env.example` and fill it in          |
| API answers `502` through Vite             | `npm run server` is not running on port 5000          |
| New company cannot publish a drive         | Expected: an admin must verify it first                |
| "You are not eligible for this drive"      | CGPA, branch, skills or deadline — the reason is shown |
| Signed out on refresh                      | Session row expired or was removed; sign in again      |
