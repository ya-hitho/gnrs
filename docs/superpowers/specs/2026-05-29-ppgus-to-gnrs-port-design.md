# Design — Port selected `ppgus` features into `gnrs` (`jalur-yasril`)

**Date:** 2026-05-29
**Branch:** `feat/ppgus-port-claude` (off `jalur-yasril`) → PR into `jalur-yasril`
**Status:** Awaiting user spec review

---

## 1. Context

`gnrs` and `ppgus` are two forks of the **same** application
(`github.com/fadhilkurnia/ppg-dashboard` — a single-binary Go + embedded React SPA
school dashboard, SQLite). They diverged early (~migration 006) and are **not
mergeable**:

| | `gnrs` (target) | `ppgus` (source) |
|---|---|---|
| Domain breadth | **Rich**: Pustaka, Kurikulum, Kelas, Tahun Ajaran, sesi, pencapaian, bacaan… | Lean |
| Migrations | 40 (next free = **041**) | 12 |
| Student/Teacher model | **Unified into one `users` table** (role `murid`/`guru`), via migration `008_unify_user_profile` | Separate `students` / `teachers` tables |
| Frontend | `web/app/src/pages/*` components, **react-router-dom** + TanStack Query + `useSearchParams` | file-based TanStack Router `routes/*` |
| i18n | **Yes** — `web/app/src/locales/{id,en}.json` + `lib/i18n.ts` (react-i18next) | none |
| Go | 1.25 | 1.22 |

Because of these differences every ported feature is **re-implemented and adapted**
into gnrs's architecture (additively), not cherry-picked.

## 2. Scope

Port these four ppgus features into gnrs (user-selected "lean high-value" set):

- **#2 — Public self-service attendance** (`/absen`) with phone → `wa.me` handoff.
- **#3 — Dynamic API-path gating** (`/api` behind a rotating 6-char prefix), **enabled by default**, plus 403-as-unauthenticated boot handling.
- **#4 — Gender filter + sortable column headers** on the Students (Generus) and Teachers (Pengajar) lists.
- **#6 — iOS/mobile form polish** (form-control reset, mobile-safari viewport/safe-area, absen tap targets).

**Explicitly out of scope** (verified to regress gnrs or be dead code in ppgus):
bulk import/export (#1, deferred), required-field validation + student `city` (#5,
deferred), dashboard gender stats (gnrs already a superset), custom roles (ppgus
scaffold is unwired), WhatsApp messaging backend (gnrs already superior client-side),
deploy/ops tooling (gnrs has its own, same host).

## 3. Decisions (locked) + chosen defaults (for review)

**Locked by user:**
- Dynamic API gate **ON by default** (`DYNAMIC_API_PATH`, default `true`).
- The `/absen` WhatsApp report keeps ppgus's **verbatim** Indonesian template,
  including the title `LAPORAN PENGAJIAN PPG`. The report body is **not** i18n'd.
- New UI surfaces localized via gnrs's existing `id`/`en` i18n.
- Target track: **`jalur-yasril`** (PR into it, not `main`; not mirrored to `gnrs-evan`).
- Full TDD + 80%+ coverage per repo rules.

**Chosen defaults for the smaller open points (flag in review if you disagree):**
- **`/absen` discoverability:** unlisted public URL (not linked from the authed UI), matching ppgus.
- **"Ada pertanyaan?" footer number:** ppgus hardcodes a personal number
  (`wa.me/628972529354`). **Drop it** in gnrs (omit the footer link) rather than ship
  someone's personal number; can be re-added/config-driven later if wanted.
- **Gender values:** `male` | `female` (matches gnrs `users.gender` + dashboard buckets).
- **Sortable columns:** `name`, `created_at`; `dir` ∈ `asc|desc`; tiebreaker `id ASC`.
  Unknown sort/dir → handler returns **400** (parity with gnrs's existing param validation),
  store still falls back to `name ASC` defensively.
- **Public form status set:** `hadir | izin_murid | izin_guru | by_vn` — **exclude `alfa`**
  (no-show is a staff judgment, not self-reported).
- **Teacher gender filter + NULL:** a gender filter excludes rows with NULL gender (no "Unset" bucket for now).
- **Meta tag name** for the API base: `gnrs-api-base`.
- **Rate limit** on public attendance POST: 10/min/IP (ppgus value).
- **Migration number:** `041`.

## 4. Cross-cutting constraints

1. **Unified `users` table.** Every backend touch goes through gnrs's
   `store.Students` (role `murid`) / `store.Teachers` (role `guru`) facades over `users`;
   there is no separate `students`/`teachers` table. Both already expose `Nickname`.
2. **Build order (matters):** **#4 → #2 → #3 → #6.**
   - #4 is independent and smallest.
   - #2 adds the `/api/public/*` endpoints.
   - #3's gate is **on by default**, so its `directAPIAllowlist` **must** include
     `/api/public/*` (from #2), plus `/healthz`, `/api/auth/login`, `/api/auth/logout`,
     and `/api/files/photos/` (browser `<img src>` cannot carry the rotating prefix).
   - #6's tap-target third lands on #2's `/absen` page, so it comes last.
3. **`#3` is a hard cutover.** Default-on means *every* SPA call must resolve through the
   dynamic base or the app 403s right after login. gnrs has **two** calling conventions —
   `lib/auth.tsx` (live auth via `api.get/post` on non-`/api` paths) **and** `apiFetch`
   (`/api/...` literals, 36 of them). Both are funneled through `request()` in `lib/api.ts`,
   so the retrofit centralizes there + in `lib/auth.tsx`. **Do not** copy ppgus's
   refresh-token machinery (gnrs has none).

---

## 5. Feature designs

### #4 — Gender filter + sortable headers  *(low)*

**Backend**
- `internal/store/students.go`: add `Gender, Sort, Dir string` to `ListParams`; append
  `gender = ?` clause when non-empty; replace fixed `ORDER BY name ASC` with an
  allowlisted order (`name`, `created_at`) + `id ASC` tiebreaker.
- `internal/store/teachers.go`: same on `TeacherListParams` (gender column is nullable `*string`).
- Extract a single shared `orderClause(sort, dir string) string` helper in `store` to avoid drift.
- `internal/handler/students.go` & `teachers.go` `List`: validate `gender` (`male|female|""`),
  `sort`, `dir`; 400 (Indonesian message) on invalid; pass through.

**Frontend**
- `web/app/src/api/students.ts` & `teachers.ts`: extend the list query types + serialize `gender/sort/dir`.
- `web/app/src/components/SortableTh.tsx` (new): label + active-sort chevron (lucide), writes `sort/dir` to URL.
- `web/app/src/pages/Students.tsx` & `Teachers.tsx`: parse `gender/sort/dir` from `useSearchParams`,
  thread into the `useQuery` key + list call, add a gender `<select>` to the filter form,
  make headers sortable; reset page to 1 on filter/sort change; only write non-default sort/dir to the URL.
- i18n (id+en): `students.allGender/genderMale/genderFemale`, `teachers.*` counterparts,
  `common.sortAsc/sortDesc`, `students.cols.createdAt`/`teachers.cols.createdAt` (if a Created column is shown).

**Tests**
- `internal/store/students_test.go`: gender filter (mixed rows), each sort/dir, bad sort → fallback.
- `internal/store/teachers_test.go`: gender filter incl. a NULL-gender row excluded; sort/dir.
- `internal/handler/students_test.go` & `teachers_test.go` (new): `?gender=female` 200,
  `?gender=bogus` 400, `?sort=created_at&dir=desc` ordering, bad sort 400.

---

### #2 — Public self-service attendance `/absen` + `wa.me`  *(medium)*

**Migration `041_attendance_submitted_phone`**
- `*.up.sql`: `ALTER TABLE attendances ADD COLUMN submitted_phone TEXT;` (nullable).
- `*.down.sql`: SQLite has no `DROP COLUMN` here — rebuild mirroring `039`'s exact column
  set **without** `submitted_phone` (keep `sesi_id` and the `alfa` CHECK), `INSERT…SELECT`,
  `DROP`/`RENAME`, recreate indexes (`idx_attendances_date/_student_date/_teacher_date/_status/_sesi`).

**Model / store**
- `internal/model/model.go`: add `SubmittedPhone *string `json:"submittedPhone,omitempty"`` to `Attendance` (after `Materi`).
- `internal/store/attendances.go`: add `SubmittedPhone *string` to `AttendanceInput`; add
  `a.submitted_phone` to the `selectAttendance` projection **and** the shared `readAttendance`
  scan (as `sql.NullString` → `*string`) — *column/scan count must stay consistent across
  `List`/`Get`/`Stats`*; add the column + placeholder to `Create`'s INSERT. `Update` left
  untouched (must not null it).

**Backend feature code**
- `internal/messaging/whatsapp.go` (new): **only** `Normalize(in string) string`
  (Indonesian `08…/+62…/62…` → `62…`). Drop ppgus's dead `Sender`/`Noop`/`Fonnte`.
- `internal/httpx/ratelimit.go` (new): port ppgus `IPRateLimiter` (token bucket + chi `Middleware`), uses `httpx.Error`.
- `internal/handler/public_attendance.go` (new): `PublicAttendance{attendances, students, teachers, validator}`.
  - `ListTeachers` → `teachers.List(TeacherListParams{Status:"active", Limit:200})` → `[]{id,name,nickname}`.
  - `ListStudents` → `students.List(ListParams{Status:"active", Limit:200})` → same shape.
  - `Create` → decode → trim+validate (`oneof=hadir izin_murid izin_guru by_vn`, `submittedPhone` required)
    → `phoneRe ^(\+?62|0)\d{7,14}$` → `time.Parse` → `messaging.Normalize` → `attendances.Create(…, SubmittedPhone)`
    → look up nicknames via `students.Get`/`teachers.Get` (degrade to name on miss, never block)
    → `buildWaMeURL(normalized, formatAttendanceMessage(...))`. `buildWaMeURL`,
    `statusLabelsUpper` (built from `model.AttendanceHadir/…`), `formatAttendanceMessage`
    (verbatim `LAPORAN PENGAJIAN PPG`), `joinNickname`, `formatDuration` live in this handler file.
    Reuse existing `trimPtr` / JSON-error helpers (same `package handler`; do not redeclare).
- `cmd/server/main.go`: build `publicAttRL := httpx.NewIPRateLimiter(10, time.Minute)`; inside
  `r.Route("/api", …)` **before** the `authMw` group register
  `GET /public/teachers`, `GET /public/students`, `api.With(publicAttRL.Middleware).Post("/public/attendances", …)`.

**Frontend**
- `web/app/src/api/public.ts` (new): `listPublicTeachers/Students`, `submitPublicAttendance` via `apiFetch`;
  types `PublicOption`, `PublicAttendanceInput`, `PublicAttendanceResponse = Attendance & {waMeUrl}`.
- `web/app/src/components/PublicAttendanceForm.tsx` (new): RHF + zod, status radios, i18n labels;
  client-side `phoneRe` mirrors the server (server is authoritative).
- `web/app/src/pages/Absen.tsx` (new): public page; on success **same-tab** `window.location.href = waMeUrl`
  (not `window.open` — popup-blocked); success fallback message when no URL.
- `web/app/src/App.tsx`: add `<Route path="/absen" element={<AbsenPage/>} />` **outside** the
  auth-gated `<Layout>` wrapper (sibling of `/login`).
- i18n: `absen.*` + `absenStatus.*` namespaces (id+en); report body excluded (stays in Go).

**Tests** (`internal/handler/public_attendance_test.go`, store test harness `store.Open(t.TempDir())+Migrate`)
- Happy path (seed active murid+guru) → 201 + `waMeUrl` starts `https://wa.me/62…`.
- Invalid phone → 400; missing teacherId → 400; status `alfa` → 400 (public excludes it).
- `ListTeachers/ListStudents` return only active members (a `left`/`retired` member excluded).
- `attendances_test.go`: `Create` with `SubmittedPhone` round-trips via `Get`.
- Frontend: Chrome-DevTools flow per TEST.md (no JS test runner in gnrs).

---

### #3 — Dynamic API-path gating, default ON + 403-as-unauth  *(medium, cross-cutting)*

**Backend (no migration — cookie-only)**
- `internal/config/config.go`: add `DynamicAPIPath bool`; `Load()` → `getBool("DYNAMIC_API_PATH", true)`.
- `internal/auth/apipath.go` (new): port ppgus — `APIPathCookieName`, `APIPathLen`, base36 alphabet,
  `GeneratePath` (6 chars, ≥1 digit, rejection-sampled), `IsValidPath`, constant-time `EqualPath`,
  cookie set/clear helpers. **Port the digit-requirement and constant-time compare exactly.**
- `internal/auth/apipath_middleware.go` (new): `DynamicAPIPath(enabled)` middleware with a
  **gnrs-specific `directAPIAllowlist`**: `/api/auth/login`, `/api/auth/logout`,
  `/api/files/photos/`, `/api/public/`. (`/healthz` is outside `/api` and already passes.)
  When enabled, requests to the canonical `/api/...` (other than allowlisted) require the
  rotating prefix; the prefix maps back to `/api`.
- `internal/handler/auth.go`: add `dynamicAPIPath bool` to `Auth` + `NewAuth`; on `Login`
  issue+set the `auth_path` cookie (MaxAge tied to `jwt.TTL()`) and return
  `authResponse{*model.User, APIBase string}`; `Logout` clears it; `Me` reports current base.
- `cmd/server/main.go`: `r.Use(auth.DynamicAPIPath(cfg.DynamicAPIPath))` after `requestLogger`;
  pass the resolver to `web.Handler(web.Config{APIBaseFor: apiBaseResolver(cfg.DynamicAPIPath)})`.
- `web/embed.go`: change `Handler()` → `Handler(cfg Config)` (a `Config{APIBaseFor func(*http.Request) string}`);
  substitute an `__API_BASE__` placeholder in `index.html` per request; `Cache-Control: no-store` on the shell.

**Frontend (the hard part — both conventions must resolve through the base)**
- `web/app/index.html`: add `<meta name="gnrs-api-base" content="__API_BASE__" />`.
- `web/app/src/lib/apiBase.ts` (new): read meta tag, `getApiBase/setApiBase`, `resolveApiPath`
  (maps `/api` and `/api/...` to the active base; falls back to `/api`).
- `web/app/src/lib/api.ts`: in `request()`, route **all** non-`http` paths through `resolveApiPath`
  (prefix bare paths with `/api` first) — replaces the current `path.startsWith('/api') ? path : …`
  short-circuit so the 36 `/api/...` literals all get rewritten. Add an `isAuthError` export.
- `web/app/src/lib/auth.tsx`: `fetchMe()` treats `isAuthError(err)` as unauthenticated (null → redirect);
  `login()`/`fetchMe()` call `setApiBase(res.apiBase)`.
- `web/app/src/api/auth.ts` + `api/types.ts`: login/me return `AuthMe = User & { apiBase: string }`; push `setApiBase`.
- Verify `KontrolBacaan.tsx` photo `<img src={`/api/files/…`}>` resolves via the allowlist (don't rewrite `<img>` URLs).

**Tests**
- `internal/auth/apipath_test.go`: `GeneratePath` always passes `IsValidPath`, distinct, table-driven `IsValidPath`, `EqualPath`.
- `internal/auth/apipath_middleware_test.go`: disabled = pass-through; non-`/api` & allowlisted pass;
  correct prefix routes; wrong/missing prefix on a gated `/api/...` → 403.
- `internal/handler/auth_test.go`: `Login` with gate on sets `auth_path` cookie + returns `apiBase`;
  update any existing assertions on the bare login/me JSON shape.
- `internal/config/config_test.go`: default true; `DYNAMIC_API_PATH=false` overrides.
- `web/embed`: served `index.html` substitutes `__API_BASE__`; resolver returns `/api` when disabled.
- Chrome-DevTools: after login, network calls go to `/<prefix>/...`; reload keeps session; photos load.

---

### #6 — iOS/mobile form polish  *(low, pure frontend)*

- `web/app/src/index.css`: append ppgus's iOS form-control reset as an **`@layer base`** block
  (`appearance:none` + bg + SVG chevron for `select`, number-spinner strip, date/time `min-height:2.5rem`).
  **Do not** copy ppgus's `min-height:100dvh` onto `html/body/#root` — gnrs uses
  `height:100%; overflow:hidden` (fixed shell + internal scroll); scope any `dvh`/safe-area to the shell/standalone pages.
- `web/app/index.html`: viewport → `width=device-width, initial-scale=1.0, viewport-fit=cover`;
  add `apple-mobile-web-app-*` + `theme-color` metas.
- `web/app/src/components/Layout.tsx`: `padding-top: max(.5rem, env(safe-area-inset-top))` on the mobile
  `<header>`; `padding-bottom: env(safe-area-inset-bottom)` on the mobile **bottom nav** (gnrs has one; ppgus didn't).
- `web/app/src/pages/Absen.tsx` (from #2): apply tap-target sizing (≥44px controls, 16px input font to avoid iOS zoom).
- **Watch-outs:** the global `select`/number/date resets touch ~24 existing gnrs selects/inputs — verify
  Dashboard, KontrolBacaan, Users, Teachers, dialogs still render correctly (chevron present, no double-arrow, dense date inputs not broken).

**Tests:** `make typecheck` (only Layout inline-style + absen classNames are TS); `make test` (Go unchanged/green);
Chrome-DevTools mobile emulation (notch/home-indicator clearance, no input-focus zoom, desktop unaffected) per TEST.md.

---

## 6. Delivery

- Worktree `.worktrees/feat/ppgus-port-claude` off `jalur-yasril`; deps installed **in-worktree**
  (prefer `pnpm`); dev server on a unique port (per gnrs CLAUDE.md / 18300–18999 convention).
- Commit per feature, conventional-commit messages, one concern per commit.
- Verify `make test` (`go test -race ./...`) + `make typecheck` green and **80%+ coverage** on touched code before PR.
- Chrome-DevTools UI verification (`/absen`, gender filter/sort, mobile insets) captured for the PR per TEST.md.
- **PR target: `jalur-yasril`.** Cross-feature contract (gate allowlist ⊇ public endpoints) noted in the PR body.

## 7. Top risks & mitigations

| Risk | Mitigation |
|---|---|
| #3 default-on cutover: a missed calling convention 403s the whole SPA after login | Centralize in `lib/api.ts` `request()` + `lib/auth.tsx`; test both conventions + photo `<img>` via Chrome-DevTools before merge |
| Photo `<img src>` can't carry the rotating prefix | Allowlist `/api/files/photos/`; verify `KontrolBacaan.tsx` |
| `readAttendance` scan/column-count drift when adding `submitted_phone` | Update projection + scan together; covered by store round-trip test |
| Migration `041` down-rebuild must reproduce post-039 schema exactly | Mirror `039` column set + indexes incl. `sesi_id` and `alfa` CHECK |
| `web.Handler()` signature change breaks other callers | Grep all callers (cmd/server, tests) and update in the same commit |
| Global CSS reset regresses gnrs's ~24 selects/number/date inputs | Scope to `@layer base`; Chrome-DevTools visual sanity on key pages |
| Edit-collision with other agents' worktrees (`feat/docs-tidy-system`) | Stay in this worktree; rebase if needed |

## 8. Open questions for reviewer (defaults chosen in §3)

1. `/absen` left unlisted (no nav link)? 
2. Drop ppgus's hardcoded "Ada pertanyaan?" WhatsApp number (vs. config-drive it)? 
3. Sortable columns limited to `name` + `created_at` (not `nickname`/`status`)? 
4. Teacher gender filter excludes NULL-gender rows (no "Unset" bucket)? 
5. Rate limit 10/min/IP acceptable for gnrs's WireGuard-only deploy? 
