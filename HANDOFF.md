# Maple Plan — Technical Handoff

Educational Canadian financial-literacy and planning platform. Single-page React app served as a static file on Vercel, backed by Supabase (Postgres + Auth + Storage + Edge Functions), with an AI coach powered by the Anthropic Messages API.

Built as a research-preview prototype in May 2026. This document is everything the next developer (or future you) needs to keep it running, debug it, or extend it.

---

## 1. Live URLs and accounts

| Thing | URL | Notes |
|---|---|---|
| Production app | https://maple-plan-david-martins-projects-42ed4350.vercel.app | Stable alias to latest production deploy. |
| Custom domain | https://maple.brightpathtechnology.io | DNS CNAME to `461b1b151c36aea5.vercel-dns-016.com.` at Google Cloud DNS. Active once DNS resolves. |
| GitHub repo | https://github.com/victorycross/maple-plan | Public. Pushes to `main` auto-deploy via Vercel. |
| Vercel project | https://vercel.com/david-martins-projects-42ed4350/maple-plan | David Martin's Projects (Pro). |
| Supabase project | https://supabase.com/dashboard/project/zydizhncvgyzewondmzr | `maple-plan` in `ca-central-1`. Brightpath Technology Inc org, ~$10/mo. |
| Supabase project ref | `zydizhncvgyzewondmzr` | Used in URLs, SDK config. |

**Sign-in:** any email + password ≥6 chars. Email confirmation is currently *disabled* in Supabase Auth → User Signups for friction-free testing. Re-enable for production after verifying email templates point at the right Site URL.

---

## 2. Tech stack

**Frontend** — single `index.html` (~104 KB), no build step:
- React 18.3.1 (UMD)
- ReactDOM 18.3.1 (UMD)
- Babel Standalone 7.24.7 (JSX in browser)
- Tailwind CSS via Play CDN
- Recharts 2.12.7 (UMD) + react-is 18.3.1 + prop-types
- Supabase JS SDK v2

**Backend** — Supabase managed services:
- Postgres 17.6 with Row-Level Security on every table
- Supabase Auth (email + password)
- Supabase Storage (private `documents` bucket)
- Supabase Edge Functions (Deno) — one function: `coach-chat`

**AI** — Anthropic Messages API, model `claude-sonnet-4-6`, called server-side from the edge function with the user's API key stored as a Supabase Edge Function secret (`ANTHROPIC_API_KEY`).

**Hosting** — Vercel static deployment from GitHub repo, auto-deploy on push to `main`.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (single index.html — React + Tailwind + Recharts)      │
│  • AuthGate wraps the app — Supabase email+password auth        │
│  • All app state in React + Supabase queries (RLS-scoped)       │
│  • CSV parsing happens client-side                              │
└──────────────┬──────────────────────────────┬──────────────────┘
               │ HTTPS                        │ HTTPS
               ▼                              ▼
┌──────────────────────────┐    ┌───────────────────────────────┐
│  Supabase REST + Auth    │    │  Supabase Storage             │
│  (auto-generated CRUD)   │    │  bucket: documents (private)  │
│  Postgres 17 + RLS       │    │  path: {household_id}/{...}   │
│  + pgvector available    │    │  RLS by household folder      │
└──────────────┬───────────┘    └───────────────────────────────┘
               │
               │ from inside Edge Function (verifies JWT, loads profile)
               ▼
┌──────────────────────────┐    ┌───────────────────────────────┐
│  Edge Function           │───▶│  api.anthropic.com            │
│  coach-chat (Deno)       │    │  /v1/messages                 │
│  ANTHROPIC_API_KEY secret│    │  model: claude-sonnet-4-6     │
└──────────────────────────┘    └───────────────────────────────┘
```

---

## 4. Database schema

All tables live in the `public` schema. Every table has RLS enabled with a policy that scopes access to `households.user_id = auth.uid()`.

### `households` (1:1 with auth.users)
```
id uuid pk
user_id uuid unique → auth.users(id) on delete cascade
name text
province text default 'Ontario'
has_spouse boolean
retirement_age, end_age int
return_rate, inflation numeric                -- decimals e.g. 0.06
monthly_expenses numeric                       -- legacy single field
monthly_expenses_essential numeric             -- new bucket model
monthly_expenses_discretionary numeric
monthly_expenses_work_related numeric
retirement_lifestyle_factor numeric default 0.80
emergency_fund, home_value, mortgage_balance, other_debt numeric
created_at, updated_at timestamptz
```

### `persons` (1-2 per household)
```
id uuid pk
household_id uuid → households on delete cascade
role text check (role in ('primary','spouse'))   -- unique per household
first_name text, age int
years_in_canada int, income numeric
cpp_pct_of_max numeric, cpp_start_age int
oas_start_age int, other_pension_annual numeric
```

### `accounts` (n per person)
```
id uuid pk
person_id uuid → persons on delete cascade
type text check (type in (
  'RRSP_1','RRSP_2','SPOUSAL_RRSP','TFSA','FHSA',
  'DPSP','DCPP','NON_REG','RESP','LIRA','LIF','RRIF'))
label, institution, notes text
balance, annual_contribution numeric
```

### `mortgages` (n per household)
```
id uuid pk
household_id uuid → households
label, institution, account_number, notes text
property_type text check (in ('primary_residence','rental','second_home','other'))
initial_balance, current_balance numeric
rate numeric (decimal), rate_type ('fixed'|'variable')
term_years, amortization_years int
payment_frequency text (monthly/semi-monthly/bi-weekly/bi-weekly-accelerated/weekly/weekly-accelerated)
payment_amount, cashback_received numeric
payments_remaining int
next_payment_date, maturity_date, start_date, amortization_end_date date
prepayment_lump_pct, prepayment_increase_pct numeric
double_payment_allowed boolean
```

### `estate_checklist` (10 items per household, unique on household_id+item_key)
```
id uuid pk
household_id uuid → households
item_key text (will, poa_property, poa_personal, beneficiaries_reviewed,
               life_insurance, disability_insurance, critical_illness,
               executor_named, funeral_wishes, digital_assets)
is_complete boolean, completed_date date, notes text
```

### `documents` (file metadata; files in Storage)
```
id uuid pk
household_id uuid → households
category, filename, storage_path, mime_type, description text
size_bytes bigint
uploaded_at timestamptz
```

### `transactions` (imported from Monarch CSV)
```
id uuid pk
household_id uuid → households
import_run_id uuid (groups per import for delete-run)
date date (indexed with household_id)
merchant, category (indexed), account_label, account_mask,
  original_statement, notes, owner, source text
amount numeric (signed: negative = outflow, positive = inflow)
tags text[]
is_transfer boolean
imported_at timestamptz
```

### `import_runs` (audit trail per CSV upload)
```
id uuid pk
household_id uuid → households
filename, source text
rows_imported, rows_skipped int
date_range_start, date_range_end date
errors jsonb
created_at timestamptz
```

### `category_mappings` (per-user category → bucket override; table exists but UI not yet built)
```
id uuid pk
household_id uuid → households
category text (unique per household)
bucket text check (in ('essential','discretionary','work_related','exclude','income'))
```

### Storage
- Bucket `documents` (private). Path pattern: `{household_id}/{category}/{timestamp}-{filename}`. RLS on `storage.objects` scopes read/write/delete to the user whose `household_id` matches the first path segment.

---

## 5. Edge function: `coach-chat`

Path: `supabase/functions/coach-chat/index.ts` (lives only in Supabase; source is in the deploy history, not the GitHub repo — see "Improvements" section).

**What it does:**
1. Verifies the caller's Supabase JWT (via `verify_jwt: true` in function config).
2. Creates a Supabase client with the user's JWT so RLS applies to all queries.
3. Loads the user's `households`, `persons`, `accounts`, `mortgages` rows.
4. Builds a system prompt combining:
   - A Canadian-financial-literacy system prompt with 2026 reference numbers
   - A summarized profile section ("THIS USER'S PROFILE")
5. Calls `https://api.anthropic.com/v1/messages` with model `claude-sonnet-4-6`, `max_tokens` 4096 (configurable in request body up to 8192).
6. Returns `{ reply, usage, model, stop_reason, max_tokens }` JSON.

**Inputs from the frontend** (POST body):
```json
{
  "messages": [{"role":"user","content":"..."}, ...],
  "max_tokens": 4096,            // optional, capped 256-8192
  "model": "claude-sonnet-4-6"   // optional override
}
```

**Auth header:** `Authorization: Bearer <user-jwt>` (sb.functions.invoke attaches this automatically).

**Cost guards:**
- `max_tokens` capped at 8192 (≈ $0.12/call worst case at Sonnet rates)
- Conversation char count capped at 80,000 (returns 413 if exceeded)
- No per-user/IP rate limiting yet — add via a `coach_requests` table + count check if abuse becomes a concern

**Redeploy via Supabase MCP:** `mcp__supabase__deploy_edge_function` with the project ref and full source. Increments version automatically. Current version: 3.

---

## 6. Secrets and configuration

| Where | Secret | What |
|---|---|---|
| Supabase Edge Function secrets | `ANTHROPIC_API_KEY` | Anthropic API key. Set at https://supabase.com/dashboard/project/zydizhncvgyzewondmzr/functions/secrets |
| Supabase Edge Function secrets | `SUPABASE_URL` | Auto-injected by Supabase. |
| Supabase Edge Function secrets | `SUPABASE_ANON_KEY` | Auto-injected. |
| Hardcoded in `index.html` | `SUPABASE_URL` | `https://zydizhncvgyzewondmzr.supabase.co` |
| Hardcoded in `index.html` | `SUPABASE_ANON_KEY` | `sb_publishable_1N1_8jSC2FMZehLjSYD_Eg_tSP-GmbA` (publishable key — safe to expose; RLS enforces all auth) |

**Supabase Auth config** (https://supabase.com/dashboard/project/zydizhncvgyzewondmzr/auth/url-configuration):
- Site URL: `https://maple.brightpathtechnology.io`
- Redirect URLs allowlist:
  - `https://maple.brightpathtechnology.io/**`
  - `https://maple-plan-david-martins-projects-42ed4350.vercel.app/**`
  - `https://maple-plan-*-david-martins-projects-42ed4350.vercel.app/**` (preview deploys)
- Confirm email: **disabled** (re-enable for production)

---

## 7. Frontend code map

Single file: `index.html` (~104 KB, ~2500 lines). Sections in order:

| Lines (approx) | Section |
|---|---|
| 1–50 | HTML head: CDN script imports (React, Recharts, Supabase, Tailwind, Babel), config injection, boot-error reporter |
| 50–100 | Supabase client init, React/Recharts destructuring |
| 100–180 | **REF_2026 constants** — federal+provincial tax brackets, RRIF table, CPP/OAS amounts, age benchmarks |
| 180–230 | **ACCOUNT_TYPES, PROPERTY_TYPES, PAYMENT_FREQUENCIES** — type registries |
| 230–280 | **Math helpers** — `fmt$`, `taxOrdinary`, `marginalRate`, `cppAnnual`, `oasAnnual`, `oasClawback`, `monthlyMortgagePayment`, `mortgageEndAgeForPrimary`, `monthlyExpensesForPhase` |
| 280–340 | **UI atoms** — `Card`, `Stat`, `NumInput`, `TextInput`, `SelectInput`, `Pill`, `SourceTag`, `Spinner` |
| 340–460 | **CSV parsing + Monarch analysis** — `parseCSV`, `MONARCH_BUCKETS`, `bucketFor`, `analyzeMonarchTransactions`, `importMonarchTransactions` |
| 460–540 | **AuthGate** component |
| 540–600 | **Data layer** — `loadAll`, `saveHousehold`, `savePerson`, `addPerson`, `addAccount`, `addMortgage`, `uploadDocument`, etc. |
| 600–740 | **Dashboard** — top stats, donut chart, mortgages summary, quick actions, embedded CashFlowPanel |
| 740–820 | **HouseholdPanel** — household settings + expense buckets + spouse toggle |
| 820–870 | **PersonPanel** — per-person fields (CPP/OAS, income) |
| 870–960 | **AccountsPanel** + **AccountRow** — n accounts per person |
| 960–1080 | **MortgagesPanel** + **MortgageRow** — n mortgages per household with full field set |
| 1080–1170 | **EstatePanel** — 10-item checklist + document upload/download |
| 1170–1230 | **ExpensePhasesExplainer** — 3-phase card for retirement |
| 1230–1330 | **RetirementEngine** — year-by-year projection, RRIF minimums, OAS clawback, drawdown table |
| 1330–1360 | **TaxCentre** — 2026 brackets, marginal rate, RRSP impact |
| 1360–1430 | **AssetDonut** — fixed pie chart with side legend |
| 1430–1620 | **CashFlowPanel** — category × monthly/quarterly/annual table (paginated transactions fetch) |
| 1620–1730 | **ImportPanel** — Monarch CSV upload, preview, commit, past-runs |
| 1730–1810 | **AICoach** — chat UI calling `sb.functions.invoke("coach-chat")` |
| 1810–1850 | **SourcesPanel** — CRA/Service Canada/FCAC links |
| 1850–end | **AppShell** + ReactDOM root render — tabs nav, view router |

**Convention:** every panel component takes `{state, refresh}` where `state = {household, persons, accounts, mortgages, estate, documents}` from `loadAll(userId)`. After a mutation, call `refresh()` to re-fetch.

---

## 8. Deployment workflow

1. **Edit `index.html` locally.** Validate the embedded JSX parses before pushing:
   ```bash
   node -e "const fs=require('fs'); const b=require('@babel/core');
   const h=fs.readFileSync('index.html','utf8');
   const m=h.match(/<script type=\"text\\/babel\"[^>]*>([\\s\\S]*?)<\\/script>/);
   try { b.transformSync(m[1],{presets:[['@babel/preset-react']]}); console.log('OK',m[1].length); }
   catch(e){ console.log('ERR',e.message,e.loc); }"
   ```
2. **Commit and push to `main` on GitHub.** Vercel auto-deploys within ~30-60 seconds.
3. **Edge function changes** are deployed separately via Supabase MCP `deploy_edge_function` (or Supabase CLI). The function source is not in the GitHub repo currently.
4. **Schema changes** via Supabase MCP `apply_migration` (migrations get tracked in `supabase_migrations.schema_migrations` automatically).
5. **Verify** by hard-refreshing the live URL. Watch for the red error banner at the bottom of the page — it's a runtime error reporter that catches any script load failure.

**Rollback:** the previous deployment is one click away on the Vercel Deployments page (https://vercel.com/david-martins-projects-42ed4350/maple-plan/deployments).

---

## 9. Common dev tasks

**Add a new account type (e.g., LIRA-2):**
1. Add to the `accounts.type` CHECK constraint: `alter table accounts drop constraint accounts_type_check; alter table accounts add constraint accounts_type_check check (type in (...));`
2. Add an entry to `ACCOUNT_TYPES` in `index.html`.
3. If it's a registered account that defers tax, also add it to the RRSP-equivalent list in `RetirementEngine`'s `sum.reduce`.

**Update 2026 tax/OAS/CPP numbers for 2027:**
- Edit the `REF_2026` constant in `index.html` (rename to `REF_2027`).
- Update `TAX_BRACKETS_ORDINARY` from the Calm Money Coach RRSP workbook or CRA's official tables.
- Update the system prompt in the edge function to reflect the new numbers.

**Add a new estate-checklist item:**
- Add an entry to `ESTATE_ITEMS` array. The `template` field can point to a markdown file in `/templates/` or be `null`.
- If you add a template file, drop it in `templates/` and push.

**Re-deploy the edge function:**
```ts
// pseudo-code via MCP
mcp.deploy_edge_function({
  project_id: "zydizhncvgyzewondmzr",
  name: "coach-chat",
  files: [{ name: "index.ts", content: "...full source..." }],
  entrypoint_path: "index.ts"
})
```

**Reset a user's data** (e.g., for QA):
```sql
delete from households where user_id = (select id from auth.users where email = 'x@y.com');
-- Cascade deletes persons, accounts, mortgages, estate_checklist, documents, transactions, import_runs
```

---

## 10. Known issues / gotchas

| Issue | Workaround / fix |
|---|---|
| Edge function source isn't in GitHub repo | It lives only in Supabase deployment history. Recovery means copy-paste from the most recent deploy via `mcp__supabase__get_edge_function`. Should be committed to `supabase/functions/coach-chat/index.ts`. |
| Supabase REST caps responses at 1000 rows regardless of `.limit()` | Use `.range(from, to)` pagination loop. `CashFlowPanel` already does this for transactions; same fix needed if any other view ever scales past 1000 rows. |
| `alert()` blocks the page including screenshot tools | Always use inline state-based messages, never `alert()` / `confirm()`. `EstatePanel` and `AccountsPanel` still have a `confirm()` for delete — fine for users but flakey for automated testing. |
| React state updates are async — double-clicks can fire two handlers before the `disabled` prop renders | Use a `useRef` synchronous guard alongside the `setBusy(true)`. `ImportPanel` already does this for both commit and apply-buckets. |
| Email confirmation is disabled | For production, re-enable in Supabase Auth → User Signups and verify the Site URL points at the live domain (not localhost). |
| AI coach has no per-user rate limit | A determined user could rack up API costs. Add a rate-limit table + check before each call if/when needed. |
| Coach context summary doesn't include transactions | Coach knows household summary + accounts + mortgages but doesn't see your imported transaction history. Would need to add a top-N-by-spend summary to the edge function's profile builder. |
| CSV import categorization is heuristic | `MONARCH_BUCKETS` maps known Monarch categories to essential/discretionary/work-related. Unknown categories fall into "uncategorized". The `category_mappings` table is built but no UI exists yet to let users override per category. |
| Mortgage category in transactions != mortgage payment in Mortgages tab | User-side data hygiene issue. Monarch's "Mortgage" category often captures only partial payments. Coach + Retirement engine use the Mortgages tab as source of truth, not transactions. |

---

## 11. Roadmap / suggested next features

In rough priority order based on user value:

1. **Commit edge function source to GitHub** under `supabase/functions/coach-chat/index.ts` so it's recoverable and version-controlled.
2. **Transactions context for the AI coach** — pass a top-20-by-spend summary to the edge function so the coach can answer "what am I spending too much on?"
3. **Category mapping UI** — let users override the bucket assignment per category. The table exists.
4. **Monthly trend chart** on the Dashboard — line chart of spending by bucket over the last 24 months derived from transactions.
5. **CPP optimization scenario explorer** — model "take CPP at 60 vs 65 vs 70" with break-even age annotations.
6. **Multi-mortgage retirement projection** — currently only the primary mortgage feeds the retirement engine; rentals should be handled as both income and debt.
7. **Monte Carlo retirement simulator** — 10,000 paths with sequence-of-returns risk; replace the deterministic 5%/6%/7% scenarios.
8. **Pension-income splitting optimizer** — for couples in retirement, find the optimal income split that minimizes combined tax + maximizes OAS retention.
9. **Email reminders** — Supabase pg_cron + Edge Function to email "estate checklist quarterly review" type nudges.
10. **Mobile-first polish** — currently desktop-optimized; the dashboard table wraps awkwardly on phones.

---

## 12. Costs

| Item | Cost | Notes |
|---|---|---|
| Supabase project | $10/mo | Pro plan slot. Storage + DB usage well under quotas. |
| Vercel hosting | $0 | Free tier; bandwidth & build minutes within limits. |
| Anthropic API | Variable, ~$0.02–0.10 per coach exchange | At Sonnet 4.6 pricing (~$3/M input, $15/M output). Set a budget alert at console.anthropic.com → Settings → Limits. |
| GitHub repo | $0 | Public repo on free tier. |
| Domain `brightpathtechnology.io` | Existing — not Maple Plan specific | Subdomain `maple.` added at no extra cost. |

**Estimated steady-state monthly cost for one active user:** $10 (Supabase) + ~$2–5 (50–100 coach queries) = **~$12–15/mo**.

---

## 13. Security and privacy notes

- **Authentication** is Supabase email+password. Every database table has RLS that scopes rows to `auth.uid()`. Even if someone got hold of the publishable anon key (which is in the HTML and safe to expose by design), they cannot read other users' data.
- **API keys** never appear in the browser. The Anthropic key is only in Supabase's Edge Function secret store, accessed server-side from the `coach-chat` function.
- **Storage** uses a private `documents` bucket with RLS on `storage.objects`. Files are addressed by path-prefix (`{household_id}/...`) and only the owner can read or write.
- **Data residency** — Supabase project is in `ca-central-1` (Montréal), aligning with most Canadian data-residency expectations. AI coach calls *do* leave Canada (Anthropic's API runs in the US per their commercial terms).
- **PII** in the system: name, age, household income, account balances, mortgage details, uploaded documents (wills, POAs, insurance). Treated as confidential per Anthropic's commercial data-use terms which say API inputs aren't used for training.
- **Audit log** — `import_runs` tracks every CSV upload. No audit log for coach interactions yet (could be added by writing each call to a `coach_logs` table).
- **Regulatory disclaimer** is shown at the top of every page. Maple Plan is explicitly educational; the system prompt forbids the coach from giving regulated advice.

---

## 14. Quick reference

- **Build a new feature:** edit `index.html`, validate JSX, commit, push → Vercel deploys in 60s.
- **Add database schema:** `mcp__supabase__apply_migration` (or use the Supabase dashboard SQL editor for one-offs).
- **Add an edge function:** `mcp__supabase__deploy_edge_function`.
- **Manage secrets:** Supabase dashboard → Project → Functions → Secrets.
- **Watch logs:** `mcp__supabase__get_logs` or dashboard → Project → Logs.
- **Reset a user:** SQL `delete from households where user_id = ...` (cascades).

---

*Generated 2026-05-31. Edits welcome — keep this doc current as the architecture evolves.*
