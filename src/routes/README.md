# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## Conventions

| File                     | URL                                                     |
| ------------------------ | ------------------------------------------------------- |
| `index.tsx`              | `/`                                                     |
| `about.tsx`              | `/about`                                                |
| `users/index.tsx`        | `/users`                                                |
| `users/$id.tsx`          | `/users/:id` (dynamic — bare `$`, no curly braces)      |
| `posts/{-$category}.tsx` | `/posts` or `/posts/:category?` (optional segment)      |
| `files/$.tsx`            | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx`            | layout route (renders children via `<Outlet />`)        |
| `__root.tsx`             | app shell — wraps every page; preserve `<Outlet />`     |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.

## Acompanhamentos: clinical records and payments

Apply `supabase/migrations/20260919140000_treatment_followup.sql` to the
Supabase database used by Acompanhamentos **before deploying the frontend**.
Use the normal Supabase migration process (or the SQL editor with an authorized
administrator). This is not a PHP/SQLite migration. The feature requires an
authenticated Supabase clinic member; it does not copy PHP-only patients,
medications, inventory or sessions into Supabase. Do not expose a service-role
key in the browser to bypass authentication.

- `/acompanhamentos`: clinical plans, protocol deadlines and return/completion
  alerts. Financial fields are configured only in `/financeiro`.
- `/acompanhamentos/$id`: the existing medication schedule remains separate from
  actual medication use. Evolution notes, weight, return visits, status reasons
  and medication uses are persisted, attributed to the authenticated user, and
  retained. A status change requires a justification. Suspend medication rather
  than deleting it once a use is recorded.
- Return intervals default to 30 days. The first due date is start + interval;
  recording a completed return advances it from the latest completed visit.
  Backdated entries cannot move it backwards. Paused plans do not generate return
  alerts; completed/cancelled plans have no next return. A due return is a clinical
  reminder, **not** a booked appointment. Expiry does not automatically discharge
  the patient or mark a protocol clinically complete.
- Photos are stored in the private `treatment-photos` bucket (JPEG/PNG/WebP, 10 MB).
  Metadata includes date, description and an objective snapshot. The same photos
  appear in the patient's medical record, grouped through their plans, in date
  order for before/after comparison. No demonstration images or browser-local
  clinical history are used by these new components. Recorded photos and clinical
  events are retained; failed uploads have explicit cleanup/error handling.
- Medication use records distinguish external/patient-owned medication from
  consumption of clinic stock. Only actual clinic consumption reduces inventory,
  in the same locked transaction as the movement and clinical record. Stock units
  are integer units, independent of the clinical dose. Retries use stable request
  IDs. Manual stock movements also use a locked RPC; editing an item's description
  cannot overwrite a concurrently consumed quantity.
- `/financeiro`: configure total, discount, entry amount/method/date, payment type
  (cash/installments/financing), balance method, installment count and first due
  date. Entry is installment zero and remains pending until receipt confirmation.
  Monthly dates clamp to month end; cent remainders are distributed without loss.
  Financing records the agreed amount, not an interest calculation. Once any
  payment is received, regeneration is blocked to preserve paid history.
- One installment synchronizer replaces the two historical payment triggers.
  New entries/installments are reflected in the ledger; receipt updates the same
  transaction. General ledger editing/deletion cannot bypass the installment UI.
  Existing historical duplicate receipts are **not** deleted by this migration;
  review/reconcile legacy duplicates separately with the finance team.
- In-app alerts are calculated from current records and refreshed every minute
  while their panel is mounted (including the notification center). They include
  overdue dates, today, the next seven days, and completed plans. They do not send
  automatic WhatsApp/email collections or require a background scheduler.

Access to new records follows the parent treatment and its company membership.
Legacy single-clinic schemas without `company_id` retain clinic membership checks.
Verify deployed tenant policies and authentication in staging before rollout.
The stock screen retains its existing integration. The finance screen now uses Supabase
as its only source; it never switches to PHP after a failure. Reconcile PHP-only financial
data before rollout. Apply the subsequent financial_settlements and financial_cash_flow
migrations before deploying the current finance UI. The Fluxo de caixa tab uses confirmed,
dated openings and recorded movements, separates card receivables, and records internal
transfers without creating revenue or executing bank operations. See the finance section
in the root README for permissions, opening-date semantics and rollout requirements.

Run `node scripts/test-treatment-followup.mjs` for the actual frontend calculation
and deadline functions (uses the installed TypeScript compiler). Also exercise the
following against a staging Supabase after applying the migration:

1. Save an evolution/weight/photo, reload, and open the patient's photo tab.
2. Record a return and verify the next date, including backdated visits and pause,
   resume, conclusion and justification history.
3. Configure R$ 1,200 with R$ 300 entry by Pix and R$ 900 in three card installments;
   confirm each receipt and check exact ledger totals and repeat submissions.
4. Register clinic medication use, retry the same request and attempt insufficient
   stock/concurrent consumption; check that no partial record or double debit exists.
5. Verify that another company and an unauthenticated session cannot read photos,
   clinical history, or invoke mutation RPCs for this patient.

The ambiguous requests about two cards per diagnosis and a “Sol” screen/profile
are intentionally not implemented without a definition.
