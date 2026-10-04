# Dependency remediation record

Date: 2026-10-04  
Work item: DEP-001  
Scope: backend, web frontend, and Expo mobile application

## Result

The web production dependency audit is clean. The backend production audit has no critical or high advisories after upgrading Joi and Nodemailer and constraining vulnerable transitive packages. CI now rejects any new critical or high backend or web production advisory.

The web spreadsheet importer now uses `read-excel-file` instead of the unpatched `xlsx` package. The frontend also moves to the patched PDF.js, React Router, Vite, and Tailwind lines. The Tailwind 4 migration preserves the existing JavaScript theme configuration and replaces custom-class `@apply` chains that Tailwind 4 no longer supports.

## Verification

- Backend: typecheck, lint, production build, and 792 unit/service tests passed.
- Frontend: typecheck, production build, and 173 tests passed.
- Playwright: 10 public, login, registration, and password-recovery visual/flow cases passed at desktop and mobile widths.
- `npm audit --omit=dev`: backend 0 critical, 0 high; frontend 0 advisories.

## Accepted residuals

Backend NestJS 10 still reports moderate/low advisories. NestJS fixes them only in version 12, which is ESM-only and is incompatible with the present CommonJS build, Jest setup, and `nestjs-pino` peer range. A forced NestJS 12 trial failed compilation and test loading and was not retained. These residuals do not satisfy a high/critical production severity threshold, but the NestJS 12 migration remains required before general availability.

Expo 57 currently has no compatible patched release for four high-severity advisory IDs inherited through its Metro/code-signing build toolchain: 1240107, 1240111, 1240912, and 1240992. These tools operate on trusted source/build inputs and are not exposed to customer data in the shipped Android bundle. CI accepts only these exact IDs and fails on any additional high or critical advisory. Re-evaluate at every Expo patch and before Play Store release.

Full audits still show development/build-tool advisories. They are not silently ignored: the backend/web production thresholds and the mobile exact-ID allowlist are enforced on every pull request.

## Rollback

Revert the DEP-001 commit and restore the three package lockfiles. Do not partially revert the Tailwind package changes without also reverting the PostCSS and stylesheet migration.
