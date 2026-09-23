# Architecture

Grateful Finance is the back office for a group of businesses — **IPC Finance**, **IWC Finance** and **The Mulberry Weddings** — built on Next.js 16 (App Router), Postgres via Prisma, NextAuth (credentials, JWT), Vercel Blob, and Google Sheets (through Apps Script).

## The one concept: Business

Everything is organised by **Business** (`model Business`, stored in the `Company` table for continuity).

| A business has | Why |
| --- | --- |
| `entity` (`GRATEFUL` \| `MULBERRY`) | The legal seller printed on its invoices — name, GSTIN, bank (`src/lib/brands.ts`). IPC and IWC both bill as Grateful. Unregistered entities (Mulberry) print no tax. |
| `invoicePrefix` + `invoiceNextNumber` | Its own invoice series. Numbers are reserved atomically (`allocateInvoiceNumber`). |
| `sheetUrl` + `sheetSecretEnc` | Its Google Sheet (Apps Script web app). Secret encrypted with `AUTH_SECRET`. Old env vars still work as a fallback for `mulberry`/`ipc`/`iwc`. |
| categories, gateways | For its money-in/out entries. |
| members | Who (non-admin) can see and act on it. |
| `color`, `slug` | Telling businesses apart in the UI; the switcher cookie. |

`Invoice.brand` is the entity **snapshot at issue** — the printed seller never changes after the fact.

### Words we don't use any more
*Company*, *brand* (as a section), *venture*, *ledger* — all mean "business" now. `src/lib/ventures.ts` is removed.

## User flow

1. **Pick a business** in the sidebar switcher (or *All businesses*). The choice is a cookie (`biz`), set via `GET /scope?b=<slug|all>&next=<path>`. Every page reads it through `getScope()`.
2. **Overview** (`/dashboard`) — collections, dues, profit, alerts for the scope.
3. **Invoices** (`/invoices`) — one list. *New invoice* uses the scoped business (asks which, when on *All*). The form depends on the business's entity: Grateful → Bajaj DO / GST certificate upload; Mulberry → package quotation.
4. **Invoice page** (`/invoices/[id]`) — the document, payments (screenshot OCR, Razorpay), email, print, edit.
5. **Payments** (`/payments`) — every payment received in scope, with gateway fees.
6. **Money in & out** (`/money`) — receipts and costs outside invoices.
7. **Reports** (`/reports`, `/reports/gst`) — P&L, GST, Excel exports.
8. **Settings** — Businesses, Team, Invoice defaults, Integrations (Razorpay), Sheet sync, Audit log. Admin only.
9. **Account** (`/account`) — change your password.

Old URLs (`/ipc`, `/iwc`, `/mulberry`, `/companies`, `/expenses`, `/settings/users`) redirect (see `next.config.ts`).

## Layers

```
src/app/(app)/**      pages — server components; read via getScope() + prisma, never trust the client
src/app/api/**        route handlers — thin: auth -> validate -> service -> JSON
src/server/           the server layer
  session.ts          requireUser / requireAdmin (routes), requirePageUser / requirePageAdmin (pages)
  access.ts           accessibleBusinessIds, assertBusinessAccess, require{Invoice,Payment,Entry}Access
  scope.ts            getScope(user) -> { businesses, current, access }, scopeWhere(scope)
  businesses.ts       allocateInvoiceNumber, previewInvoiceNumber, sheetTarget, slugify
  errors.ts           ApiError + helpers, withApiErrors (maps Zod / Prisma errors to 4xx)
  validation.ts       zod helpers: parseForm, parseJson, money, isoDate, gstin, password...
  rateLimit.ts        Postgres-backed fixed windows; enforce(name, subject); LIMITS
  audit.ts            audit({...}) and diff(before, after, labels)
  services/           domain logic: invoices, payments, entries, businesses, users
src/lib/              pure logic (GST maths, parsers, formatting) + integrations (sheet, Razorpay, mailer, storage)
src/proxy.ts          optimistic gate: no session cookie -> /login
```

Rules:
- **Every route** starts with `requireUser()`/`requireAdmin()`, validates input with zod, and checks business access before reading or writing a record.
- **Every write** to invoices, payments, entries, businesses, users and settings writes an `AuditLog` row.
- **Sheet sync** runs in `after()` and never throws (`src/lib/sheet.ts`); failures land in `SheetSyncFailure` for retry.
- **Money** is rupees as `Float`, rounded to 2 places at the edges (`money()` in validation, `round2` in calc).

## Security

- **Auth**: NextAuth credentials + JWT (7 days, sliding). The token is re-checked against the database every 60 s: a deleted, deactivated or demoted user, or one whose password changed (`sessionVersion` bump), is signed out within a minute.
- **Login**: emails compared lowercased; constant-time on unknown emails (dummy bcrypt); rate-limited per email (5 / 15 min) and per IP (30 / 15 min); same message for every failure.
- **Access**: admins see everything; members only their businesses (invoices, payments, entries, files, exports, reports). Deleting invoices, managing businesses, team and integrations is admin-only.
- **Rate limits** (`LIMITS` in `src/server/rateLimit.ts`): login, invoice email, document parsing/OCR, Razorpay API, general writes.
- **Headers**: frame-ancestors none / X-Frame-Options DENY, nosniff, HSTS, strict referrer, permissions policy (`next.config.ts`).
- **Secrets at rest**: Razorpay key secret and sheet secrets encrypted (AES-256-GCM, key from `AUTH_SECRET`).
- **Files**: private Blob storage, served only through `/api/uploads/[name]` after an access check on the owning record.

## API contracts

All responses are JSON. Errors: `{ error: string, fields?: Record<string, string> }` with a 4xx/5xx status; 429s carry `Retry-After`.

| Route | Who | Notes |
| --- | --- | --- |
| `GET /scope?b=&next=` | user | switch business (sets cookie, redirects) |
| `GET /api/businesses` | user | businesses the user can access |
| `POST /api/businesses` | admin | `{ name, slug?, entity, color?, invoicePrefix, invoiceNextNumber, defaultGstPercent? }` |
| `GET/PATCH /api/businesses/[id]` | user / admin | PATCH any of the above + `sheetUrl`, `sheetSecret` (write-only; `""` clears), `archived: boolean`, `reviewed: true` (clears needsReview) |
| `POST /api/businesses/[id]/sheet-test` | admin | calls the sheet's `doGet`, returns `{ ok, workbook?, error? }` |
| `POST/DELETE /api/businesses/[id]/categories[/catId]` | admin | `{ name }` |
| `POST/PATCH/DELETE /api/businesses/[id]/gateways[/gwId]` | admin | `{ name, chargePercent }` |
| `PUT /api/businesses/[id]/members` | admin | `{ userIds: string[] }` |
| `GET /api/invoices/next-number?businessId=` | member | `{ number }` preview |
| `POST /api/invoices` | member of business | form: `businessId`, optional `invoiceNumber` (else allocated), customer/item fields, `source` (`DO`\|`GST`\|`QUOTATION`), files |
| `PATCH /api/invoices/[id]` | member | JSON edit; `businessId` move allowed for admins between businesses of the same entity |
| `DELETE /api/invoices/[id]` | admin | |
| `POST /api/invoices/[id]/payments`, `PATCH/DELETE /api/payments/[id]` | member | as before (Razorpay fields, proof) |
| `POST /api/invoices/[id]/email` | member | rate-limited |
| `POST /api/invoices/parse` | user | rate-limited |
| `GET/POST /api/entries`, `GET/PATCH/DELETE /api/entries/[id]` | member | money in/out: `businessId, direction, categoryId, gatewayId?, description?, date, grossAmount, gstPercent, screenshot?` |
| `GET/POST /api/users`, `PATCH/DELETE /api/users/[id]` | admin | PATCH `{ name?, role?, active?, password? }` — role/active/password changes end that user's sessions |
| `PUT /api/users/[id]/businesses` | admin | `{ businessIds: string[] }` |
| `POST /api/account/password` | user | `{ currentPassword, newPassword }` — signs out other sessions |
| `GET /api/export`, `GET /api/export/gst` | member | `?businessId=&from=&to=&direction=` (scoped to access) |
| `GET /api/audit` | admin | `?businessId=&entityType=&entityId=&cursor=` |
