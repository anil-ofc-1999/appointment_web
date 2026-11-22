# appointment_web — Doctor Appointment Booking (Angular)

Angular frontend for the Doctor Appointment Booking sample project.

The API lives in a separate repository: **appointment_node_API**.
Requirements and decisions are kept there (single source of truth):

- Requirements: `appointment_node_API/docs/REQUIREMENTS.md` (§8 lists the screens)
- Decisions log: `appointment_node_API/docs/DECISIONS.md`
- How we work (branches, commits, PRs): [CONTRIBUTING.md](CONTRIBUTING.md)

## Tech stack

| Layer         | Technology                                      |
| ------------- | ----------------------------------------------- |
| Framework     | Angular 21 (standalone components, signals)     |
| Language      | TypeScript (strict)                             |
| Runtime       | Node.js 24 (see `.nvmrc`)                       |
| Unit tests    | Vitest via `ng test` (jsdom)                    |
| Lint / format | angular-eslint (incl. accessibility) + Prettier |
| CI            | GitHub Actions (`.github/workflows/ci.yml`)     |

## Run locally

1. Start the API first (in `appointment_node_API`): `npm run dev` → http://localhost:3000
2. In this repo:

```powershell
npm install
npm start
```

3. Open http://localhost:4200 — the home page shows **API status: connected**.

`npm start` uses `proxy.conf.json`, so calls to `/api` and `/health` go to the API on
port 3000 (no CORS setup needed in development).

## Scripts

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm start`          | Dev server on http://localhost:4200 with API proxy |
| `npm test`           | Unit tests (once)                                  |
| `npm run test:watch` | Unit tests in watch mode                           |
| `npm run lint`       | ESLint (TypeScript + templates + accessibility)    |
| `npm run format`     | Format all files with Prettier                     |
| `npm run build`      | Production build to `dist/`                        |
| `npm run check`      | lint + format check + tests + build (same as CI)   |
| `npm run e2e`        | End-to-end tests (Playwright, real API + database) |
| `npm run e2e:headed` | E2E tests in a visible Google Chrome window        |
| `npm run e2e:demo`   | Slow, visible run in your installed Google Chrome  |
| `npm run e2e:report` | Open the HTML report of the last E2E run           |

A **pre-commit hook** (`.githooks/pre-commit`, enabled by `npm install`) runs
`npm run check` and blocks the commit if anything fails.

## Tests

| Layer      | Tool                | Where              | What                                                         |
| ---------- | ------------------- | ------------------ | ------------------------------------------------------------ |
| Unit       | Vitest (`ng test`)  | `src/**/*.spec.ts` | Validators, auth service, interceptor, guards, pages (+ / −) |
| End-to-end | Playwright (`e2e/`) | `e2e/*.spec.ts`    | Real browser → Angular → API → PostgreSQL, desktop + mobile  |

### Running the E2E tests

Needs: PostgreSQL running, and `appointment_node_API` next to this folder with its `.env`
(override the location with `API_DIR`). First time only: `npx playwright install chromium`.

```powershell
npm run e2e
```

Playwright starts its **own** API on port 3100 and web server on port 4300, so it does not
clash with `npm run dev` / `npm start`. Test users are always `e2e-*@example.com` and are
deleted before and after the run — seed data is never touched.
E2E is not in CI yet (it needs the API repo and a database in the same job).

## Status

| Screen (REQUIREMENTS §8)     | Status |
| ---------------------------- | ------ |
| 1. Login / Register          | Done   |
| 2. Doctor search             | Done   |
| 3. Doctor detail + slot grid | Done   |
| 4. Booking confirmation      | Done   |
| 5. My Appointments           | Done   |
| 6. Doctor dashboard          | Done   |
| 7. Admin panel               | Done   |
