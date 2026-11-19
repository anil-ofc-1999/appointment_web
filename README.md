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

A **pre-commit hook** (`.githooks/pre-commit`, enabled by `npm install`) runs
`npm run check` and blocks the commit if anything fails.

## Status

Foundation done: app shell, API health check, tooling and CI.
Next: the screens from REQUIREMENTS §8 (login/register first).
