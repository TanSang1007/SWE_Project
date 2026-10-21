# P01-D3B1 — Minimum payment policy and cross-machine portability

2026-10-18. D3-01 **USER APPROVED** in the P01-D3B1 implementation request.
Verification results are recorded in machine evidence (evidence kiểm thử cũ đã dọn).
P00 remains frozen. D3-02/D3-03 are approved directions for later tasks, not implemented here.

## Baseline and preservation boundary

HEAD before work: `780584ca302fc9a06ddba27c1c4cd8fdf5b739a2`. Pre-existing modified
Development Plan, D2 report/evidence, next-env and untracked D3A report were preserved.
The task does not stage those D2/D3A changes or next-env. Only this task's additive
Development Plan hunk may enter its commit; earlier D3A hunk stays unstaged.
Fresh READ ONLY development snapshot captured before DB-backed tests; no development
fixture writes, migration/reset/seed/restore or payment settlement is performed.

## Implemented policy and effective provider

| Server final total | Effective VNPAY_SANDBOX | MOCK |
| --- | --- | --- |
| 0 | Existing explicit internal zero confirmation | Existing zero confirmation unchanged |
| 1–4,999 VND | Reject new Order/initiation/retry | Existing behavior unchanged |
| >=5,000 VND | Continue existing validations/amount ceiling | Existing behavior unchanged |

The backend `minimum-payment-policy.ts` resolves ConfigService's effective mode:
default MOCK needs no merchant configuration; selected VNPAY requires a valid
normalized Sandbox config; invalid selected mode/config fails closed503. Startup's
synthetic-only gate is unchanged and remains responsible for preventing real
development/production activation. This policy adds no flag/provider writer or
request override, and does not implement the controlled real-merchant gate.
No float conversion, rounding, increased charge, point clamp, discount removal,
immutable Order repricing or gateway→Mock fallback.

## Exact guard locations and transaction safety

`OrderService.create`: existing exact replay/owner serialization/claim/active-order
checks → PricingService/current catalog/size/topping/Promotion → account proof →
`validateRedemption` → **effective-provider/minimum check** → `effect(RESERVE)` →
stock OCC → Order/items → journal/balance/claim completion → commit.
Minimum compares Decimal `loyalty.total` after both discounts. PROCESSING claim was
inserted in the same transaction, so rejection rolls it back; no committed Order,
Attempt, Payment, Award, debt/journal/reservation change or Cart write remains.
No schema CHECK restricting historical/Mock amounts and no migration is added.

`AttemptService.initiate`: gate/key/owner → locks/replay → pending/review/receipt/state/
retry eligibility → **minimum guard** → existing gateway ceiling/encoder/account
checks → durable claim/Attempt/URL/retry reacquisition. New retry below minimum
does not increment cycle, re-reserve stock/points, change failed Order or issue URL.
`canRetry` and `canResume` are false for below-minimum amounts. Pending/UNKNOWN/REVIEW
guards keep precedence; minimum cannot be used to bypass unsafe cancel/retry.

## API error, replay and historical compatibility

HTTP422, existing error envelope:

```json
{
  "error": {
    "code": "VNPAY_MINIMUM_AMOUNT_NOT_MET",
    "message": "Thanh toán VNPAY yêu cầu số tiền tối thiểu 5.000đ. Vui lòng điều chỉnh giỏ hàng hoặc số điểm sử dụng."
  }
}
```

No merchant config, secret or signed URL in the error. Rejected creates leave no
claim, so a corrected request can reuse the rolled-back key; the UI instead creates
a new intent after explicit correction. Completed CREATE_ORDER/PAY_ORDER requests
still replay exact recorded responses before the new minimum policy; different
payload/action remains409. Same-key concurrency reserves once, different-key
concurrency cannot bypass one-active-unpaid-order or reserve twice.

Existing below-minimum Order remains readable; no automatic cancel/release/reprice.
Explicit unpaid cancellation remains governed by current money-state guards.
Existing Attempt replay retains identity/ref/amount/URL/expiry; no replacement URL.
The issuance guard is deliberately **not** added to `toVnpayAmount`, callback HMAC,
Return or settlement validation. Authentic historical late IPN still settles/reviews
by existing financial rules. Historical verified failure retry cannot reacquire
resources below minimum. UNKNOWN/REVIEW never become FAILED due to this policy.

Zero uses existing INTERNAL_ZERO Payment0/Award0/EARN0 and SETTLE when redeemed;
no external Attempt/gateway call or second stock debit. MOCK behavior below minimum,
old replay and payment methods remain; VNPAY mode still backend-denies Mock payment.

## Frontend validation UX

Checkout displays the exact safe minimum message. Definitive create422 clears only
the rejected create intent, retaining Cart, Promotion and entered points so the user
can adjust and explicitly submit again. Timeout/503/uncertainty retains stable-key
recovery. Payment errors do not navigate to VNPAY or create a replacement Attempt.
Primary VNPAY button stays “Thanh toán”, no WALLET/CARD selector, no redesign or
Admin/auth change. Existing Mock and explicit zero flows remain.

## Cross-machine portability compliance and limits

New business code depends on injected backend ConfigService/Decimal and relative
imports only. No personal filesystem root, username, hostname, ngrok domain, DB
password or merchant key. Tests use synthetic fixture values, environment-provided
TEST_DATABASE_URL and random owned schema; no shared development database needed.
Portability tests exercise equivalent localhost/127.0.0.1 configs, default MOCK with
no merchant, invalid selected config, production/development rejection, and static
absence of machine/domain dependencies in the new policy.

The updated gateway browser harness accepts exported `BROWSER_PATH` instead of a
fixed Windows executable. Build directory is repo-relative/configurable through
`BREWLITE_BROWSER_BUILD_DIR`; evidence prefix is validated via
`BREWLITE_BROWSER_EVIDENCE_PREFIX`. `.env.example` documents these optional test
settings; harness does not load private `.env`/merchant configuration. No new
application environment variable or startup behavior is introduced.

Existing findings outside this task: `frontend/test/browser-verify.mjs` retains
Windows executable discovery and phase-specific ignored build/database-location
artefacts; full automated cross-OS/fresh-clone onboarding is not certified. D3A's
concrete audit domain/filesystem paths describe observations, not future runtime
requirements. D3-02 must validate each machine's own approved callback config, not
hardcode the original developer's hostname/domain/database credentials. No broad
refactoring or real gate change is included.

## Future fresh-clone prerequisites — full fresh-clone NOT RUN

1. Clone into any writable repository directory. Use Node24 LTS >=24.11,<25 and
   npm11 per package engines/lockfile; run `npm ci` at root (PowerShell `npm.cmd ci`).
2. Copy root `.env.example` to `.env` and frontend `.env.local.example` to
   `frontend/.env.local` only when absent. Configure your own local PostgreSQL
   user/password/database URL, matching frontend API/CORS origin and local random
   JWT secret. `node backend/scripts/configure-auth-env.cjs` can generate local
   sample/missing auth secret; never commit env files.
3. Start your PostgreSQL instance (tested baseline18.6), create your own empty
   development database and a local role with the required migration permissions.
   Do not point at another developer's DB. Keep PAYMENT_PROVIDER_MODE=MOCK;
   merchant variables may remain absent. Use NODE_ENV=development for demo seed.
4. Run `npm run db:validate`, `npm run db:migrate:deploy`, `npm run db:generate`,
   then optionally `npm run db:seed` on that new development DB for demo catalog/
   Promotion. Do not edit applied SQL. These are future setup instructions, not
   commands executed on development in D3B1.
5. Start `npm run dev:backend` and `npm run dev:frontend` in separate terminals;
   open localhost3000 on that machine. Verify register/login, catalog/options,
   Cart/Promotion/Loyalty preview/create, Mock success/failure, Order history and
   explicit zero confirmation. PostgreSQL network setup remains local/private.
6. Optional DB regression uses a separately created loopback test database named
   `brewlite_b2a_<12 lowercase hex>_test`; export its URL as both DATABASE_URL and
   TEST_DATABASE_URL for test processes, never the development DB. Suites create/
   drop their own schemas and apply the repository migration chain there.
7. Optional browser run: prepare an isolated frontend source production build
   with API base localhost3201; set BREWLITE_BROWSER_BUILD_DIR to it and BROWSER_PATH
   to the installed Chromium/Edge executable. Leave loopback3200/3201 free; run
   `npm run test:gateway:browser --workspace frontend`. It uses synthetic HTTP and
   blocks external HTTPS navigation, not real merchant transactions.
8. VNPAY Sandbox needs a later approved gate/session, that developer's independently
   authorized/rotated credentials and registered callbacks. Copying env samples is
   not activation. Production gateway remains denied; QueryDr external remains OFF.

## Verification, evidence and remaining blockers

Full unit/HTTP, isolated PostgreSQL, frontend, lint/typecheck/build, Prisma and
browser results are PASS, with exact counts in machine evidence:

| Check | Final result |
| --- | --- |
| Backend unit/HTTP |825/825,27 suites;812 baseline +13 new |
| Full isolated PostgreSQL |731/731,27 suites;705 baseline +26 new |
| Frontend |229/229;228 baseline +1 new |
| Real Edge, synthetic HTTP/no DB/provider |11 groups,390/768/1366, keyboard/accessible alert/Cart/entered selections/correction;0 runtime/hydration issues |
| Both lint/typecheck/build |PASS; frontend built from isolated source copy, root next-env untouched |
| Prisma validate/status/diff |PASS;13 up to date/no schema difference |

All baseline backend/PostgreSQL test cases are retained, comparing name multisets
after normalizing per-run random fixture UUIDs/timestamps. The initial full DB run
reported729/731: two old ingress fixtures still attempted new subminimum VNPAY
Orders. Creating those historical fixtures in MOCK corrected their setup, without
relaxing production guards; final full run731/731 PASS. Browser harness follow-up
fixed an enabled-button timing race and ensured corrected points matched its
synthetic response; final11 groups PASS with error/selection assertions intact.
These are transparent test-harness corrections, not claims that failed runs passed.

Boundary/pricing/rollback/idempotency/history/provider tests cover0/1/4999/5000/
5001/85000, discounts, size/topping DB prices, all-table snapshots and authentic
historical callback/replay. Baseline ingress tests now model subminimum historical
Orders in MOCK before switching the isolated provider; assertions enforce the new
issuance policy, not the old synthetic minimum gap. No baseline suite is removed.

Development preservation compares13 completed SQL checksums,19 fingerprints, full
catalog/functions/sequences and protected bytes before/after. Existing D2/D3A,
P00, schema/migrations, next-env and unrelated files remain preserved. Expected
negative-path Nest logs/pg deprecation notices are reported separately from assertions.

D3B2 remains separately assigned: implement approved portable development opt-in/
stop-new/drain. Merchant rotation/IPN registration, actual browser/ngrok/cloud
retention, network/provenance closure and supervised actual Sandbox E2E are still
required. D3-03 allows initial IPN/Return sequencing, not live QueryDr enable or
UNKNOWN/REVIEW bypass. No activation, tunnel, live API, deploy or push in D3B1.

**P01-D3B1 COMPLETE — READY FOR CONTROLLED GATE IMPLEMENTATION**.
P01-D3B2 is not started automatically. Local commit SHA is reported in final/Git;
the evidence does not self-reference its own commit hash.
