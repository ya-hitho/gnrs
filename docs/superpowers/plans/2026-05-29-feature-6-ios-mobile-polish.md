# iOS/Mobile Form Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port ppgus's iOS/mobile-Safari polish (form-control reset, viewport-fit/safe-area/theme-color metas, header + bottom-nav safe-area insets, and `/absen` tap targets) into gnrs as pure frontend CSS/className changes, without regressing gnrs's fixed-shell layout.

**Architecture:** Four independent, additive frontend edits — (a) append the ppgus iOS form-control reset to `web/app/src/index.css` as a new `@layer base` block (NOT touching gnrs's existing `html/body/#root { height:100%; overflow:hidden }`); (b) add `viewport-fit=cover` + `apple-mobile-web-app-*` + `theme-color` metas to `web/app/index.html`; (c) add `env(safe-area-inset-top/bottom)` insets to the mobile `<header>` and mobile bottom `<nav>` in `web/app/src/components/Layout.tsx` via inline `style`; (d) apply ≥44px tap targets + 16px input font to `/absen` (depends on feature #2's `Absen.tsx`/`PublicAttendanceForm.tsx`; conditional). No backend, no migration, no new i18n keys.

**Tech Stack:** React 18 + react-router-dom, Tailwind CSS v3 (`@layer base`/`@layer utilities`), Vite, TypeScript. gnrs has **no frontend test runner** (verified: `web/app/package.json` scripts are only `dev`/`build`/`preview`/`typecheck` — no vitest/jest), so frontend verification is `make typecheck` + `make test` (Go unchanged) + the Chrome-DevTools mobile-emulation flow per `TEST.md` / `CHROME_DEVTOOLS.md`.

**Dependency note:** Task 4 (`/absen` tap targets) depends on **feature #2** having created `web/app/src/pages/Absen.tsx` and `web/app/src/components/PublicAttendanceForm.tsx`. If #2 has not landed in this worktree yet, Task 4 is **deferred** — do Tasks 1–3 (which are #2-independent) now, and run Task 4 after #2 merges. Tasks 1–3 have no dependency on any other feature.

---

### Task 1: iOS form-control reset in index.css

**Files:**
- Modify: `web/app/src/index.css` (append a new `@layer base` block after the existing one ending at line 19)
- Test: none (CSS; verified by `make typecheck` no-op + Chrome-DevTools visual sanity in Task 5)

**Watch-out:** gnrs's existing `@layer base` sets `html, body, #root { height: 100%; overflow: hidden; }` (fixed shell + internal scroll). **Do NOT** add ppgus's `min-height: 100dvh` to those elements. Only port the form-control resets (`appearance:none` + bg + SVG chevron for `select`, number-spinner strip, date/time `min-height`). The global `select`/`input[type=number]`/`input[type=date]` resets touch ~24 existing gnrs inputs across Dashboard/KontrolBacaan/Users/Teachers/dialogs — Task 5 is the mandatory visual-sanity pass to confirm no double-arrow selects, no broken dense date inputs, chevron present.

- [ ] **Step 1: Write the failing check (typecheck baseline)**
There is no unit test for CSS. Establish the green baseline that Task 1 must preserve. Run the current typecheck so a regression in Task 4 (which edits TS) is attributable later:
Run: `make typecheck`
Expected: PASS (this is the pre-edit baseline; CSS edits do not affect `tsc`).

- [ ] **Step 2: Confirm the constraint you must not violate**
Run: `grep -n "height: 100%" web/app/src/index.css`
Expected: prints `8:  height: 100%;` (the existing `html, body, #root` rule). This is the line you must leave untouched — your new block must NOT re-declare `min-height` on `html`/`body`/`#root`.

- [ ] **Step 3: Append the form-control reset `@layer base` block**
Append to `web/app/src/index.css`, immediately after the existing `@layer base { … }` block (after line 19, before `@layer utilities {` on line 21). This is the ppgus reset (read verbatim from `/workspace/ppgus/web/app/src/index.css` lines 5–88), minus its `@tailwind` directives (already present in gnrs) and with NO `html/body/#root` height rule:
```css

@layer base {
  /*
   * iOS Safari paints native chrome on form controls (date/time spinners,
   * select chevrons, button gradients, inset shadows on text fields,
   * rounded corners on number spinners). The native styling overrides
   * Tailwind's height utilities and gives forms (e.g. /absen) visibly
   * inconsistent row heights — a 44px text field next to a 36px date next
   * to a 40px select. Strip appearance so our utility classes own the
   * height, borders, and background.
   *
   * Type=number is intentionally listed so the up/down spinners go away.
   * Type=submit/reset/button are not listed: the <Button> component
   * already paints over the native chrome, and stripping appearance on
   * a bare <button> would erase fallback affordances elsewhere.
   *
   * NOTE: unlike ppgus, this block deliberately does NOT set
   * min-height:100dvh on html/body/#root — gnrs uses a fixed shell
   * (height:100%; overflow:hidden, declared in the @layer base above).
   */
  input[type='text'],
  input[type='search'],
  input[type='tel'],
  input[type='url'],
  input[type='email'],
  input[type='password'],
  input[type='number'],
  input[type='date'],
  input[type='time'],
  input[type='datetime-local'],
  input[type='month'],
  input[type='week'],
  select,
  textarea {
    -webkit-appearance: none;
    appearance: none;
    background-color: #fff;
    /* Without background-clip: padding-box, iOS Safari paints the
     * background under the border, leaking a 1px sliver of color. */
    background-clip: padding-box;
  }

  /* Date/time inputs lay their value out as inline children inside a
   * shadow root; iOS sets the host height from that content so h-* on
   * the input is silently ignored. Forcing min-height brings them back
   * in line with text inputs at the same Tailwind utility. */
  input[type='date'],
  input[type='time'],
  input[type='datetime-local'],
  input[type='month'],
  input[type='week'] {
    min-height: 2.5rem;
  }
  @media (min-width: 640px) {
    /* sm: */
    input[type='date'],
    input[type='time'],
    input[type='datetime-local'],
    input[type='month'],
    input[type='week'] {
      min-height: 2.5rem;
    }
  }

  /* appearance:none strips the native chevron from <select>, so paint
   * a chevron in the background. SVG is inlined so we don't add a
   * network request. !important on padding-right is the only way to
   * win against Tailwind's px-3 utility (utilities cascade after base),
   * so long option values don't slide under the chevron. */
  select {
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.625rem center;
    background-size: 1rem 1rem;
    padding-right: 2rem !important;
  }

  /* iOS Safari renders a 16x16 spinner on type=number that pushes the
   * value sideways. We've already added inputMode='numeric' for the
   * keypad, so kill the spinners as well. */
  input[type='number']::-webkit-outer-spin-button,
  input[type='number']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type='number'] {
    -moz-appearance: textfield;
  }
}
```

- [ ] **Step 4: Verify build + typecheck still pass (CSS is parsed at build time)**
Run: `npm --prefix web/app run build`
Expected: PASS — Vite/PostCSS compiles the CSS with no `@layer`/syntax errors and emits the bundle. (`make typecheck` also still PASSes; it is unaffected by CSS.)

- [ ] **Step 5: Commit**
```bash
git add web/app/src/index.css
git commit -m "style: add iOS form-control reset layer"
```

---

### Task 2: viewport-fit + apple-mobile-web-app + theme-color metas

**Files:**
- Modify: `web/app/index.html:5` (viewport meta) and `web/app/index.html:5-6` (insert metas after viewport)
- Test: none (static HTML; verified by Chrome-DevTools in Task 5)

**Watch-out:** Feature #3 adds a `<meta name="gnrs-api-base" content="__API_BASE__" />` to this same `<head>`. The metas added here are orthogonal — if #3 has already landed, just leave its meta in place and insert these alongside. ppgus's `index.html` (read at `/workspace/ppgus/web/app/index.html`) only carries `viewport-fit` implicitly via the spec; ppgus did **not** ship apple-mobile/theme-color metas, so the values below are the standard mobile-Safari PWA set: `theme-color #ffffff` (matches gnrs's white mobile `<header>` / `bg-slate-50` body), status-bar `default`, title from the existing `<title>GNRS US</title>`.

- [ ] **Step 1: Confirm current viewport meta (the line to change)**
Run: `grep -n 'name="viewport"' web/app/index.html`
Expected: prints `5:    <meta name="viewport" content="width=device-width, initial-scale=1.0" />` — confirms the exact string to replace.

- [ ] **Step 2: Update the viewport meta to add `viewport-fit=cover`**
Edit `web/app/index.html`, replace line 5's viewport meta:
```html
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover"
    />
```
`viewport-fit=cover` is what makes `env(safe-area-inset-*)` (used in Task 3) resolve to the notch/home-indicator insets instead of `0`.

- [ ] **Step 3: Insert the apple-mobile-web-app + theme-color metas**
Edit `web/app/index.html`: directly after the viewport `<meta …/>` (and before `<title>`), insert:
```html
    <meta name="theme-color" content="#ffffff" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="GNRS US" />
    <meta name="mobile-web-app-capable" content="yes" />
```

- [ ] **Step 4: Verify the SPA still builds with the new `<head>`**
Run: `npm --prefix web/app run build`
Expected: PASS — Vite transforms `index.html`, emits the bundle, and the metas appear in `web/app/dist/index.html`. Spot-check: `grep -c 'apple-mobile-web-app-capable' web/app/dist/index.html` prints `1`.

- [ ] **Step 5: Commit**
```bash
git add web/app/index.html
git commit -m "feat: add mobile-safari viewport and pwa metas"
```

---

### Task 3: safe-area insets on mobile header + bottom nav (Layout.tsx)

**Files:**
- Modify: `web/app/src/components/Layout.tsx:120` (mobile `<header>` — add `style` with `paddingTop`) and `web/app/src/components/Layout.tsx:251-254` (mobile bottom `<nav>` — add `style` with `paddingBottom`)
- Test: none (verified by `make typecheck` + Chrome-DevTools in Task 5)

**Watch-out:** These are the only two mobile-only chrome elements (`md:hidden`). Use inline `style` with `env(safe-area-inset-*)` — Tailwind v3 has no built-in `env()` utility and gnrs's `tailwind.config.ts` has an empty `theme.extend`, so inline style is the simplest correct approach (matches the spec's "padding-top: max(.5rem, env(safe-area-inset-top))" intent). The desktop sidebar (`<aside>`) and the `<main>` scroll region are untouched. ppgus's `_authed.tsx` did **not** actually use safe-area insets (it uses `min-h-screen`), so this is a gnrs-specific adaptation, not a verbatim port.

- [ ] **Step 1: Establish typecheck baseline**
Run: `make typecheck`
Expected: PASS (pre-edit baseline; the inline `style` objects added below are valid `React.CSSProperties` so this must still PASS after the edit).

- [ ] **Step 2: Add safe-area-inset-top to the mobile `<header>`**
Edit `web/app/src/components/Layout.tsx`. The mobile header currently (line 120) is:
```tsx
      <header className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 md:hidden">
```
Replace it with (drop `py-2`, move vertical padding into the inline `style` so the top side can grow with the notch inset while the bottom stays `0.5rem`):
```tsx
      <header
        className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 md:hidden"
        style={{
          paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
          paddingBottom: '0.5rem',
        }}
      >
```

- [ ] **Step 3: Add safe-area-inset-bottom to the mobile bottom `<nav>`**
Edit `web/app/src/components/Layout.tsx`. The mobile bottom nav currently (lines 251–254) is:
```tsx
      <nav
        className="flex flex-shrink-0 items-stretch overflow-x-auto border-t border-slate-200 bg-white md:hidden"
        aria-label={t('nav.mainMenu')}
      >
```
Replace it with (add the home-indicator inset below the row of nav links):
```tsx
      <nav
        className="flex flex-shrink-0 items-stretch overflow-x-auto border-t border-slate-200 bg-white md:hidden"
        aria-label={t('nav.mainMenu')}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
```

- [ ] **Step 4: Verify typecheck passes**
Run: `make typecheck`
Expected: PASS — both inline `style` objects are valid `React.CSSProperties` (string CSS values), no TS errors.

- [ ] **Step 5: Commit**
```bash
git add web/app/src/components/Layout.tsx
git commit -m "feat: apply safe-area insets to mobile chrome"
```

---

### Task 4: `/absen` tap targets (DEPENDS ON FEATURE #2)

**Precondition (gate):** This task edits files **created by feature #2**:
- `web/app/src/pages/Absen.tsx`
- `web/app/src/components/PublicAttendanceForm.tsx`

Run this gate first:
Run: `test -f web/app/src/pages/Absen.tsx && test -f web/app/src/components/PublicAttendanceForm.tsx && echo PRESENT || echo DEFERRED`
- If `DEFERRED`: **stop here**, do not attempt Task 4. Record in the PR/handover "Task 4 deferred until feature #2 lands `/absen`." Tasks 1–3 stand alone.
- If `PRESENT`: proceed. The exact `className` strings below mirror ppgus's `/absen` tap-target sizing (read from `/workspace/ppgus/web/app/src/routes/absen.tsx`): ≥44px-high controls (`h-12`/`min-h-[44px]`), full-width primary actions on mobile that shrink at `sm:`, and `text-base` (16px) on inputs to defeat iOS focus-zoom.

**Files:**
- Modify: `web/app/src/pages/Absen.tsx` (success-state CTA + secondary button heights)
- Modify: `web/app/src/components/PublicAttendanceForm.tsx` (submit button height + input font size)
- Test: none (verified by Chrome-DevTools mobile emulation in Task 5)

- [ ] **Step 1: Re-read the #2 files as built**
Before editing, read both files to anchor the exact current strings (they were authored by #2, so do not assume the line numbers below — match on content):
Run: `grep -n 'submitLabel\|className=\|<a\|<Button\|<Input\|<input' web/app/src/pages/Absen.tsx web/app/src/components/PublicAttendanceForm.tsx`
Expected: prints the button/input/anchor sites you will size up.

- [ ] **Step 2: Establish typecheck baseline**
Run: `make typecheck`
Expected: PASS (pre-edit baseline with #2 already merged).

- [ ] **Step 3: Apply tap-target sizing to the success-state CTAs in `Absen.tsx`**
In `web/app/src/pages/Absen.tsx`, ensure the success-state "send WhatsApp" anchor and "send another" button carry ppgus's tap sizing. The anchor should be:
```tsx
                <a
                  href={waMeUrl}
                  className="inline-flex h-12 w-full items-center justify-center rounded-md bg-emerald-600 px-4 text-base font-medium text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:h-11 sm:text-sm"
                >
                  {t('absen.sendWa')}
                </a>
```
and the secondary button:
```tsx
            <Button
              type="button"
              variant="secondary"
              className="h-12 w-full text-base sm:h-10 sm:w-auto sm:text-sm"
              onClick={() => {
                mutation.reset()
                setSubmitted(false)
              }}
            >
              {t('absen.sendAnother')}
            </Button>
```
If #2 already produced these exact classes (it ported the same ppgus page), this step is a no-op confirmation — verify and move on; do not duplicate elements.

- [ ] **Step 4: Apply 16px input font + ≥44px submit in `PublicAttendanceForm.tsx`**
In `web/app/src/components/PublicAttendanceForm.tsx`, ensure each text/tel/date/time input and each `<select>`/status control carries `text-base` (16px, prevents iOS focus-zoom) and the controls are ≥44px tall (`h-11`/`h-12` or `min-h-[44px]`), and the submit button is full-width ≥44px on mobile. Concretely, on the phone/text inputs add `text-base` to their `className` (e.g. an input rendered as `className="... h-11 ..."` becomes `className="... h-11 text-base ..."`), and the submit button:
```tsx
      <Button type="submit" disabled={pending} className="h-12 w-full text-base sm:h-11 sm:text-sm">
        {submitLabel}
      </Button>
```
Match the actual element/prop names #2 used (the `Input` component forwards `className`); the load-bearing additions are `text-base` on inputs and `h-12`/`h-11` heights on the actionable controls.

- [ ] **Step 5: Verify typecheck passes, then commit**
Run: `make typecheck`
Expected: PASS — className-only edits, no type changes.
```bash
git add web/app/src/pages/Absen.tsx web/app/src/components/PublicAttendanceForm.tsx
git commit -m "style: enlarge absen tap targets for mobile"
```

---

### Task 5: Verification — typecheck, Go tests, Chrome-DevTools mobile + regression sweep

**Files:** none (verification only)

gnrs has **no JS test runner** (`web/app/package.json` exposes only `dev`/`build`/`preview`/`typecheck`). So the gates are: `make typecheck`, `make test` (Go is untouched by this feature, must stay green), and the Chrome-DevTools mobile-emulation flow per `TEST.md` + `CHROME_DEVTOOLS.md`. Build and run the dev container per the worktree `CLAUDE.md` (`gnrs-dev-<slug>` on a free `127.0.0.1:18300-18999` port) before driving Chrome.

- [ ] **Step 1: Frontend typecheck**
Run: `make typecheck`
Expected: PASS — equivalently `npm --prefix web/app run typecheck` (`tsc -b --noEmit`) reports no errors.

- [ ] **Step 2: Go tests (regression guard — must be unchanged/green)**
Run: `make test`
Expected: PASS — `go test ./... -count=1` all green. This feature changes no Go; a failure here means an unrelated break, not this feature.

- [ ] **Step 3: Production build (CSS + HTML compile end-to-end)**
Run: `npm --prefix web/app run build`
Expected: PASS — Vite emits `web/app/dist/` with the new metas in `dist/index.html` and the form-reset CSS in the emitted stylesheet (`grep -rl 'background-clip' web/app/dist/assets/*.css` finds it).

- [ ] **Step 4: Pre-flight the shared Chrome, then build + run the dev container**
Read `CHROME_DEVTOOLS.md` and run its pre-flight (confirm the shared headless Chrome on `127.0.0.1:9222` is up — do not restart it). Then per worktree `CLAUDE.md`:
```bash
podman build -t gnrs-dev-ppgus-port-claude:latest .
podman volume create gnrs-data-dev-ppgus-port-claude
podman run -d --name gnrs-dev-ppgus-port-claude \
  --env-file .env -e PORT=8080 \
  -p 127.0.0.1:18361:8080 \
  -v gnrs-data-dev-ppgus-port-claude:/app/data \
  gnrs-dev-ppgus-port-claude:latest
podman logs --tail 50 gnrs-dev-ppgus-port-claude
```
Expected: container healthy, logs show the server listening; `http://localhost:18361/healthz` returns 200. (Pick another free `18300-18999` port if `18361` is taken; record it in the PR.)

- [ ] **Step 5: Chrome-DevTools — mobile emulation: safe-area + no focus-zoom**
Using `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` tools (one tab for this task): `new_page` → `navigate_page` to `http://localhost:18361/login`; `emulate` an iPhone-class device with a notch (e.g. iPhone 14 Pro) or `resize_page` to 390x844 with DPR 3; `take_screenshot`. Sign in with the seed admin creds from `.env`. Then:
  - Confirm the **mobile top header** content clears the status-bar/notch (its `padding-top` resolves to `max(0.5rem, env(safe-area-inset-top))`) and the **bottom nav** clears the home indicator (`padding-bottom: env(safe-area-inset-bottom)`); capture `take_screenshot` of both.
  - Focus a text input (e.g. on `/students` search) and confirm **no iOS focus-zoom** (the viewport scale stays 1 — inputs are `text-base`/16px and `viewport-fit=cover` is set).
Expected: header/nav content is not clipped by the notch/indicator; focusing an input does not zoom the page.

- [ ] **Step 6: Chrome-DevTools — `<select>` chevron + date/number regression sweep (~24 inputs)**
Still in the same emulated tab, navigate through the screens that own the bulk of gnrs's form controls and confirm the global reset did not regress them: **Dashboard**, **`/bacaan` (KontrolBacaan)**, **`/pengaturan` → Users / Teachers**, and at least one **dialog** (e.g. add/edit student or a settings dialog). For each, `take_snapshot`/`take_screenshot` and verify: every `<select>` shows exactly **one** chevron (the inlined SVG, no native double-arrow), date/time inputs render at the normal dense height (`min-height:2.5rem`, not collapsed or oversized), and number inputs have **no** spinner. Also `list_console_messages` — no new errors.
Expected: single chevron on all selects, dense date inputs intact, no number spinners, console clean of new errors.

- [ ] **Step 7: Chrome-DevTools — `/absen` tap targets (only if Task 4 ran)**
If Task 4 was `PRESENT`/done: navigate to `http://localhost:18361/absen` in the emulated mobile tab, `take_screenshot`, and confirm the submit button, status controls, and success-state CTAs are ≥44px tall and full-width on mobile, with 16px inputs (no focus-zoom). If Task 4 was `DEFERRED`, skip this step and note it.
Expected: actionable controls are finger-sized; no focus-zoom on the phone/text fields.

- [ ] **Step 8: Desktop regression check**
`resize_page` back to a desktop viewport (e.g. 1280x800), reload, and confirm the desktop sidebar layout, selects, and date/number inputs are visually unchanged (the safe-area insets are `md:hidden`-scoped to mobile chrome and resolve to `0` with no notch; the form reset is appearance-only).
Expected: desktop unaffected.

- [ ] **Step 9: Record verification in the handover/PR body**
No commit (verification only). Capture for the PR's "Tested via Chrome DevTools" section: the dev URL/port, the device emulated, and the screenshots from Steps 5–8 (mobile insets, select-chevron sweep, `/absen` if applicable, desktop unchanged), plus the `make typecheck` / `make test` / build results. Note explicitly if Task 4/Step 7 was deferred pending feature #2.
