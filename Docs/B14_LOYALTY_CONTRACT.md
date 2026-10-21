# B14 — Loyalty balance

**L00 frozen design addendum — NOT IMPLEMENTED, 2026-10-14:** D43 future L01 adds debt/held/rate fields and owned bounded journal history; loyaltyPoints remains available, current no-history scope below is pre-L01.
[Final contract](L00_LOYALTY_REDEMPTION_CONTRACT.md) supersedes only those future extension clauses; existing evidence below is historical baseline. No L01 implementation in L00.

**LOYALTY READY (technical user scope), 2026-10-09 (Asia/Saigon).** User-approved extension D34: GET /loyalty and /loyalty expose the authenticated customer's current stored balance. Award business rules, database schema and PDF requirements are unchanged. Order history remains B15; internal paid cancellation/reversal remains B16.

## Scope and acceptance mapping

Sources: [requirements](REQUIREMENTS.md), [API §14](API_DESIGN.md#14-loyalty-balance--b14-approved-extension-d34), [database](DATABASE_DESIGN.md), [architecture](ARCHITECTURE.md), [D34](DECISIONS.md#d34--b14-current-loyalty-balance-accepted-user-2026-10-09), [development plan](DEVELOPMENT_PLAN.md), [matrix](TRACEABILITY_MATRIX.md), [B11](B11_PAYMENT_CONTRACT.md), [B12](B12_CHECKOUT_ACCEPTANCE.md), [B13](B13_PROMOTION_CONTRACT.md).

| Source | B14 application |
| --- | --- |
| FR16 / Task10, BR08–09/11–12/14, Q11 | Read current points to demonstrate unchanged PAID award from immutable discounted Order.total |
| User-approved D34 | One new GET /loyalty endpoint and /loyalty page; explicit bounded exception to D32's earlier no-inferred-endpoint restriction |
| NFR02/05/10 | JWT ownership, strict input, sanitized errors, read-only balance, loading/zero/error/Retry and session isolation |
| NFR03/04/06/07 | Responsive/keyboard UI, lint/build/regression, PostgreSQL/browser evidence, documentation/local Git |

No /loyalty/history, public award/write API, pagination, tier/redemption/expiration, new actor, adjustment history or new requirement. Login balance is a historical snapshot and is not authoritative for this page. B15 will use existing GET /orders/me and earnedPoints rather than a new Loyalty history API.

B15 follow-up: Order history/confirmation now implement the existing GET /orders/me and GET /orders/:id projections, including current effective earnedPoints per Order. [B15 evidence](B15_ORDER_HISTORY_CONTRACT.md). GET /loyalty remains the sole current-balance endpoint; award rules and B16 reversal boundary are unchanged. B14 results below remain historical; mislabeled punctuation/Vietnamese characters from the earlier document write were restored during this cross-contract update.

## Pre-flight and development seed

Starting HEAD: `dd9cbfb905d5cfea90ff746905c2e12aba7e22b8`. Six pre-existing modified files were classified before editing:

| File | Existing change | B14 handling |
| --- | --- | --- |
| Docs/B13_PROMOTION_CONTRACT.md | Promotion-only seed follow-up evidence | Preserved; excluded from B14 commit |
| Docs/DEVELOPMENT_PLAN.md | B13 seed follow-up paragraph | Preserved unstaged; only B14 hunks enter B14 commit |
| README.md | Promotion-only seed instructions | Preserved unstaged; only B14 hunks enter B14 commit |
| backend/prisma/seed.cjs | Shared helper/--promotion-only mode | Preserved; excluded from B14 commit |
| backend/test/database/promotions.spec.ts | Additional promotion-only CLI integration test | Preserved and tested; excluded from B14 commit |
| frontend/next-env.d.ts | Next dev generated type paths | Original bytes restored after builds; excluded from B14 commit |

The earlier B14 pre-flight draft is replaced by this approved contract. No unclassified user changes were reverted or overwritten.

Read-only audit verified localhost:5432/brewlite_dev/public contains one BREW10K: fixed discount10000/minimum0, active, valid UTC 2026-01-01,2028-01-01). Existing B13 follow-up records its actual promotion-only seed execution twice; current SELECT independently confirms development data exists. No seed rerun was needed. Seed/backend configuration resolve the root .env; this task's owned E2E backend uses the verified development configuration. No reset/drop/public user-data deletion.

Public Loyalty snapshot at pre-flight:5 awards,0 wrong owners/formulas,0 balance-to-unreversed-award-sum mismatches,0 PAID/PREPARING/READY/COMPLETED Orders missing active owner award. Only aggregate counts are reported.

## Existing B11 features reused

| Feature | Audit / implementation |
| --- | --- |
| Decimal floor(Order.total/10000), snapshot after discount | Already implemented; PaymentService unchanged |
| Award at PAID, unique/order including0 | Already implemented; existing schema/constraints unchanged |
| Payment/Order/stock/Cart/award/balance/claim transaction | Already implemented; atomic guarded balance increment and owner serialization retained |
| Failure/retry/replay/concurrency safety | Already implemented; retained and regressed |
| Balance in login response | Existing snapshot; not used by new page |
| Current earnedPoints for owned Order | Existing GET /orders/:id projection; no new history feature |
| Fresh current balance endpoint/UI | Added in B14 |
| Order history / internal reversal | B15 / B16 respectively; not implemented in B14 |

95000 VND earns9;9000 earns0. PENDING/PAYMENT_FAILED/unpaid CANCELLED do not award. Successful retry awards once; idempotency replay and COMPLETED never award again. No Float business arithmetic or second award engine.

## Implemented API and security

GET /loyalty: existing JwtAuthGuard, identity only from verified JWT sub/req.user.id. No accepted query/body fields; injected userId/loyaltyPoints/limit return400 VALIDATION_ERROR. No user-specific path/history/write endpoint.

HTTP200 `{ "loyaltyPoints": 9 }`, including `{ "loyaltyPoints": 0 }` for a new user. LoyaltyService uses a fresh Prisma user.findUnique with select:{loyaltyPoints:true}; no Orders/products lookup, writes, timestamp updates or award mutation. Response contains no identity/email/hash/token/Prisma data. Points follow existing nonnegative INTEGER bounds.

Cache-Control: private, no-store, max-age=0; Vary: Authorization preserves CORS Vary: Origin. Missing/invalid/expired JWT or missing user401 UNAUTHORIZED. Balance-query failure503 SERVICE_UNAVAILABLE; guard-lookup failure retains the existing sanitized500 INTERNAL_SERVER_ERROR contract. User deleted between guard/read returns401. Errors use the existing envelope and never expose raw SQL/credentials.

## Frontend

Authenticated navigation links to /loyalty. Fresh GET on mount/re-entry and on native Tải lại điểm/Thử lại button; fetch cache:no-store, credentials:omit, memory JWT and5s timeout. No authoritative balance cache or frontend increment. Page states: announced loading/busy/disabled action, one current balance, Vietnamese zero-points explanation, generic alert/Retry, guest login with safe returnTo.

Session-keyed component, effect AbortController and token checks discard results after unmount/logout/account switch. Late401 from an old account cannot clear a newer session. A current401 clears auth/balance view. Browser reload follows existing memory-only JWT policy: login again, then fresh GET. API parsing rejects negative/fractional/string/overflow points. Existing typography/colors/panels retained; navigation wraps on mobile; minimum44px button and visible keyboard focus.

## Reversal boundary — B16

Internal PAID -> CANCELLED must reverse exactly original award.points, retain immutable original points and set reversedAt once. Guard against double reversal and insufficient balance; negative balance is disallowed. Aggregate snapshot stock restoration/status/award/balance effects commit atomically or roll back. Missing award/wrong owner/insufficient balance is sanitized invariant503; CAS/state conflicts use existing409. Payment SUCCEEDED and paidAt retain history; no automatic refund. B14 does not implement cancellation/reversal.

## Verification

| Check at repository root | Observed result |
| --- | --- |
| npm.cmd run test --workspace backend | 5 suites72/72 PASS, including13 new B14 HTTP/security/error/cache assertions |
| npm.cmd run test --workspace frontend | 81/81 PASS, including7 new B14 parser/API/render/session tests |
| npm.cmd run test:database --workspace backend -- --json --outputFile=../.b14-database-results.tmp | 9 suites204/204 PASS:198 existing B04–B13 assertions plus6 B14 integration scenarios; D33 worker isolation retained |
| npm.cmd run lint | Both workspaces PASS, max-warnings0 |
| npm.cmd run build --workspace backend / frontend | Both PASS; /loyalty compiled |
| npm.cmd run db:format / db:validate / db:generate / db:status | PASS; schema unchanged,2 migrations up to date |
| npm.cmd run test:loyalty:browser --workspace frontend | Edge154.0.4258.62 + owned compiled Next/Nest + PostgreSQL PASS; B06–B13 regression and B14 scenarios |

New PostgreSQL suite uses a local _dev/_test connection, fresh UUID schema and existing migrations; teardown removes only that run's schema/fixtures. A: initial0/PENDING0/SUCCESS9 and read-only refresh/catalog-change independence. B: same-key replay/new-key rejection leaves award/balance unchanged. C/D: FAILURE/replay0 then SUCCESS retry9 once, old FAILED replay cannot reduce/increase balance. E:105000-10000=95000 awards9; later9000 records award0, balance9. JWT/expired/owner-injection isolation and concurrent different-key payments verify one award and ledger balance equality. Existing B11/B13 suites cover rollback at each write, Decimal maximum/zero/discount boundaries, same/different-key races and stock/idempotency lifecycles.

Backend HTTP tests cover precise projection/no-store/Vary,0/9/current changed balance, no auth/expired/unknown/deleted user, unknown inputs/routes/writes and safe read/guard database errors. Frontend tests cover fresh balance versus login snapshot, repeated requests, zero/loading/error, strict INTEGER parsing, retry recovery and late200/401 isolation.

Full regression is the204-test run plus full backend/frontend tests/lint/build/Prisma checks, not the earlier71-test audit. These results describe the preserved working tree, including the pre-existing additional B13 promotion-only test (28 Promotion assertions); that unrelated test/seed change is excluded from the B14 commit. Known pg concurrent-query deprecation and intentional sanitized fault logs are non-failing. D33 native-crash root cause remains unproven; no native termination occurred in the completed regression. [Regression report (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)).

## Browser evidence and remaining issues

Real automated Edge154.0.4258.62 with owned compiled Next3000/Nest3001 and real PostgreSQL: initial user0/zero state; regression successes produce40; delayed GET shows busy/loading/no balance; re-entry performs fresh GET; network fault produces generic alert, native keyboard Tab/Enter Retry recovers40; reload loses memory JWT, login re-fetches40. Payment FAILURE leaves40 in DB/API/UI; SUCCESS retry on same snapshot62000 awards6, fresh page46; same-key Payment replay plus balance refresh stays46 with6 successes/6 awards. A second real account sees0, not46; controlled401 clears session and removes balance. Re-login original account reads46. Thirteen Loyalty GETs observed. Layouts390x844/768x1024/1366x768 have no overflow and45px action height. Existing B06 menu/detail, B07 auth, B08 Cart, B10 Order, B11 Payment/stock/idempotency, B12 recovery/keyboard and B13 Promotion acceptance all rerun unchanged.

Browser/network/layout evidence (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)); screenshots 390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)). Assertions also retain checkout layouts for PENDING/FAILED/PAID and promoted Orders, while this B14 run saves only the three Loyalty images. Owned processes and fixture accounts/history/Promotions were cleaned; original catalog price/stock/version/timestamps and existing Promotion rows match before/after. No existing human user history was deleted.

Two preliminary browser runs timed out in Edge full-page screenshot capture. Screenshot-only timeout allowance increased, unnecessary discarded/checkout regression captures omitted in the B14 mode, background throttling disabled and final Loyalty images use viewport captures. All business/responsive/keyboard assertions remain enabled. The final run completed exit0; the earlier screenshot timeouts are not claimed as a product defect fixed. Historical B06–B13 reports/images were not overwritten.

Automated E2E is distinct from human manual QA. Human manual QA, Firefox/full browser matrix, NFR01 latency measurement, team review/full DoD and deployment are not claimed. No B15/B16 work, schema/dependency/award-policy change or push/remote action.
