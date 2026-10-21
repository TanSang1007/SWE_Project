# B16 — Order status transition and workflow

**L00 frozen design addendum — NOT IMPLEMENTED, 2026-10-14:** D43 future L01 refunds exact redeemed points and reverses original stored award via debt-aware accounting/journal; unexplained corruption still503, graph/Payment/paidAt unchanged.
[Final contract](L00_LOYALTY_REDEMPTION_CONTRACT.md) supersedes only those future extension clauses; existing evidence below is historical baseline. No L01 implementation in L00.

**ORDER WORKFLOW READY (technical user scope), 2026-10-10 (Asia/Saigon).** This contract was written before implementation and finalized after the checks below passed. Starting HEAD: `4282dd4e7a2016bd4e57b24cb2453021049137ed`; B13 follow-up `a8a6538e643b353dbe7ade664e42c2c9574a37c3` is present. The only initial tracked diff is generated `frontend/next-env.d.ts` (`.next/types` -> `.next/dev/types`); its exact pre-flight bytes are preserved and excluded from B16 staging.

## Baseline and acceptance sources

All eight PDF pages were read using a temporary standard-library extractor; SHA256 remains `08efc9a6cc247123500419f01160c76712ec773affc998d2193f2873ef5312cc`. The PDF is unchanged. [PDF](BrewLite-CongNghePhanMem.pdf) §9/9.1 (pPDF7–8) requires the graph and invalid-transition tests; §3.2 (pPDF4) places Barista functionality outside MVP. [REQUIREMENTS](REQUIREMENTS.md) §4/6 maps FR11/12, FR14/16 and BR03/05/07–09/11–13; NFR02/04/06/07/10 govern authorization, build, tests, documentation and atomicity. FR09/10 are regression/read-projection dependencies. NFR01/full browser matrix remain B18 checks, not implied by these tests.

| Business rule | Authoritative source |
| --- | --- |
| Seven statuses and exact edges; no skipped preparation/terminal exits | PDF §9.1; REQUIREMENTS §6 state machine; API_DESIGN §9 |
| Internal service/test calls only; no STAFF/ADMIN role, operator API/UI or HTTP bypass | DECISIONS Q02/D06/D14/D23/§5; ARCHITECTURE §7/9; DESIGN_REVIEW DR04 |
| Customer may cancel only owned PENDING/PAYMENT_FAILED; CANCELLED repeat no-op | API_DESIGN §9 cancel-unpaid; DECISIONS Q03/D31; B10 contract |
| B16 owns internal PAID cancellation; restore snapshot qty and reverse original award atomically | DECISIONS DR14/DR15/D24/D28/D32; REQUIREMENTS §6 lifecycle AC; B11/B14 contracts |
| Keep award.points; set reversedAt once; atomic balance subtraction guarded by balance >= points | DATABASE_DESIGN §3 loyalty_awards/invariants, §6; ARCHITECTURE §9; API_DESIGN §9 |
| Missing award/wrong owner/insufficient balance/overflow -> invariant503 rollback, no clamp | API_DESIGN §9; DATABASE_DESIGN §3/6; B14 Reversal boundary |
| Preserve Payment success/amount/paidAt; no refund; replay remains historical | DECISIONS DR14/DR15; API_DESIGN §7/9/10; B11/B15 contracts |
| User serialization + status/version CAS, sorted Product OCC; no automatic retry | DECISIONS D08/D11/D31/§4; ARCHITECTURE §6/9; DATABASE_DESIGN §6 |

No essential contract is missing or contradictory. DESIGN_REVIEW §2–5 has no open finding; Q01–Q19 and DR14/DR15 are closed or scoped. Auth has no role column/claim and that agrees with the approved boundary; no Auth migration/provisioning is needed.

## Existing B10–B15 audit

| Feature | Pre-B16 classification | Code/evidence |
| --- | --- | --- |
| PENDING creation, stock claim, immutable snapshots | ALREADY IMPLEMENTED | OrderService.create; B10 |
| SUCCESS -> PAID; FAILURE -> PAYMENT_FAILED; failed retry via PENDING using snapshots | ALREADY IMPLEMENTED | PaymentService.pay/transition/stock; B11 |
| Cancel PENDING / PAYMENT_FAILED / repeat CANCELLED | ALREADY IMPLEMENTED | OrderService.cancel; B10/B11 |
| Product stock/version OCC and aggregate quantity | ALREADY IMPLEMENTED | OrderService.create/cancel, PaymentService.stock |
| PAID award unique/order including0 and atomic balance; purchased Cart clearing | ALREADY IMPLEMENTED | PaymentService.pay; B11/B14 |
| JWT ownership and active unpaid restrictions | ALREADY IMPLEMENTED | JwtStrategy/OrderController/order-policy; B07/B10 |
| GET /orders/me and GET /orders/:id, all status/earnedPoints projections | ALREADY IMPLEMENTED | OrderService.history/get; B15 |
| Full graph enforcement | PARTIALLY IMPLEMENTED | Payment/unpaid guards exist; no shared assertTransition/full preparation command |
| Internal preparation and PAID cancellation/reversal | NOT IMPLEMENTED | B16 backlog; B15 later-status fixtures only prove projection |
| Staff/Admin API/UI | Outside approved scope | Q02/D06/D14/D23, not a missing B16 deliverable |

## State transition matrix

Rows are current status; columns are target. Y means a graph edge, dash means reject409 INVALID_ORDER_STATE, including self-edges.

| From / To | PENDING | PAID | PAYMENT_FAILED | PREPARING | READY | COMPLETED | CANCELLED |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PENDING | - | Y | Y | - | - | - | Y |
| PAID | - | - | - | Y | - | - | Y |
| PAYMENT_FAILED | Y | - | - | - | - | - | Y |
| PREPARING | - | - | - | - | Y | - | - |
| READY | - | - | - | - | - | Y | - |
| COMPLETED | - | - | - | - | - | - | - |
| CANCELLED | - | - | - | - | - | - | - |

Repeated cancel on CANCELLED is a command no-op returning current detail, not a graph edge. PAYMENT_FAILED -> PAID happens only through two Payment transitions inside its existing transaction.

## Authorization and endpoint contract

| Caller | Allowed action | Boundary |
| --- | --- | --- |
| Public/unverified JWT | No private Order/Payment action | Existing JwtAuthGuard401 |
| JWT customer owner | Create/pay, read history/detail, cancel unpaid | Existing DTO whitelist/ownership; missing or cross-owner404 |
| JWT customer, even with client role/status/expectedVersion | Cannot prepare/complete/cancel PAID | No public status route; cancel paid409, injected body400 |
| Trusted backend service/test harness | PAID -> PREPARING -> READY -> COMPLETED; PAID -> CANCELLED | `OrderService.transitionOrder(orderId, expectedVersion, targetStatus)`; no HTTP controller binding |
| STAFF/ADMIN | No such app role in baseline | No invented provisioning, claim or UI |

No endpoint is added or changed. Existing POST /orders, POST /payments, POST /orders/:id/cancel, GET /orders/me, GET /orders/:id and GET /loyalty retain method/DTO/JWT/response/error contracts. Internal command returns the existing current detail projection. Unknown/forbidden graph or internal target409 INVALID_ORDER_STATE; stale/CAS/recognized lock conflict409 CONCURRENT_UPDATE; missing404 ORDER_NOT_FOUND; malformed expectedVersion400 VALIDATION_ERROR; technical/invariant faults503 SERVICE_UNAVAILABLE. Internal targets are limited to PREPARING/READY/COMPLETED/CANCELLED; payment/unpaid effects remain in their established write paths.

## Transaction and cancellation

One existing short Prisma transaction (maxWait50ms, deadline400ms, PostgreSQL lock200ms/statement300ms). Read owner, acquire the same user-row lock as Payment/Cart/create/cancel, reread Order, assert command scope/graph and expectedVersion, CAS status/version/updatedAt. The expected version supplied by trusted callers is never silently replaced with a reread version. Preparation changes only Order status/version/updatedAt; snapshots/Payment/Cart/Stock/Loyalty stay unchanged; COMPLETED never awards again.

PAID cancellation additionally restores aggregate snapshot quantities in sorted Product ID order via stock/version CAS and bounds, reads original owner award, guards reversedAt NULL, sets reversedAt, atomically subtracts original points with balance >= points. All effects commit together; any failure rolls back all effects. Award points are never recomputed from current price, Order total, policy or balance. Zero points still mark reversal. Payment/paidAt/snapshots and historical claims remain unchanged. Two cancel commands may both return CANCELLED but only one mutates; cancel versus preparation permits one edge to commit, the loser returns a clear conflict. Stale preparation cannot skip steps even if an earlier request advances the Order.

## Acceptance and verification

Verify the full49 graph pairs, actual A/B/C preparation, invalid/missing/stale requests, no intermediate skip, customer/ownership/injection/no-route security, expected-version races, exact unchanged snapshots/Payment/Cart/stock/awards during preparation. Verify paid-cancel qty aggregation/multiple products, original award reversal/balance equality/zero, repeated/concurrent cancel, cancel/preparing and payment/cancel races, two orders same owner, payment replay after cancellation, rollback after each write and invariant/bounds failures with direct table reads. Use fresh UUID schema and existing migrations; cleanup only that schema, never reset development DB.

| Command at repository root | Actual result |
| --- | --- |
| npm.cmd run test --workspace backend | 7 suites145/145 PASS:96 B04–B15 +49 graph pairs |
| npm.cmd run test --workspace frontend | 93/93 PASS; application UI unchanged |
| npm.cmd run test:database --workspace backend | 11 suites263/263 PASS:214 B04–B15 +49 B16 integration cases; no skipped tests |
| npm.cmd run lint | Both workspaces PASS, max-warnings0 |
| npm.cmd run build | Next and Nest PASS; generated Prisma client included |
| npm.cmd run db:format / db:validate / db:generate / db:status | PASS; no schema/migration diff,2 migrations up to date |
| npm.cmd run test:history:browser --workspace frontend -- --evidence-prefix=B16 | Owned compiled Next3000/Nest3001, real PostgreSQL and Edge155.0.4283.45 PASS; B06–B15 customer regression |

Sanitized regression and individual test evidence (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)). PostgreSQL B16 uses a UUID schema scoped both in Prisma and raw SQL search_path, applies existing migrations and drops only its own schema. Direct table reads and SQL balance SUM verify actual effects. New tests cover A/B/C preparation and owner history/detail current status; all snapshots/Payment/Cart/stock/awards/claims unchanged except Order state/version/timestamp. Invalid/terminal/skipped/stale commands preserve every row. Missing Order404, malformed expectedVersion400, expected-version races, concurrent duplicate preparation, cancellation versus preparation and stale cancellation versus payment are verified.

Paid-cancel tests restore aggregated quantities3+1 across two products with exactly one Product version increment each, reverse12 original points, preserve immutable Payment/paidAt/snapshots/claims/Cart, and compare balance to unreversed-award SUM. A historical-policy fixture stores7 award points while total still120000; cancellation reverses7 exactly, proving no formula recomputation. Zero-point awards receive the reversal marker. Repeated/concurrent cancel has no double effects; two Orders same user and concurrent cancel/new Payment preserve contributions and atomic balance updates. Old Payment replay after cancellation returns historical PAID/award response without mutation; new key rejects CANCELLED; current GET detail/history/Loyalty remains CANCELLED/0/SUCCEEDED.

Actual AFTER UPDATE PostgreSQL triggers fault at Order, second sorted Product, award and user balance; all writes roll back and retry after removing the fixture trigger succeeds. BEFORE triggers suppress a guarded update: Order/Product count0 ->409, award/balance count0 ->503 with rollback. Missing award/wrong owner/already-reversed marker/insufficient balance/stock overflow/Product version overflow/Order version overflow all return invariant503 and leave pre-state intact. Real user/product locks exceed lock_timeout and return409 CONCURRENT_UPDATE; no partial mutations or automatic retry.

HTTP security tests prove missing/invalid/expired JWT rejection, common cross-owner404, owner paid-cancel409, injected role/status/userId/expectedVersion400, and absent public PATCH status/POST transition routes404 even for a valid JWT carrying a fabricated ADMIN claim. STAFF/ADMIN permission tests/provisioning are N/A under Q02/D06/D23; the internal method is not exposed via HTTP.

## Frontend and browser evidence

Staff management UI/login/actions and staff workflow browser scenarios are N/A under the accepted baseline. Existing customer status labels/history/confirmation already handle all seven states; B16 changes no application UI. Service/PostgreSQL tests exercise actual preparation/cancellation and subsequent owned GETs. Browser regression verifies existing checkout/history/balance behavior, rather than claiming a staff workflow E2E.

Automated customer regression (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)) records B06 menu/detail, B07 Auth, B08 Cart, B10 Order, B11 Payment, B12 retry/recovery, B13 Promotion, B14 Loyalty and B15 history A–F on real apps/DB. Read-only public-table fingerprints, no create/payment/cancel during reads, snapshots after catalog/Promotion drift, refresh/re-login, ownership/401 isolation, keyboard Retry and responsive390/768/1366 all PASS. Images: history390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), confirmation390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), Loyalty390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)). Only test harness evidence-prefix support changed, preserving historical B06–B15 artifact paths by default. Owned apps/browser/accounts/order/Promotion fixtures cleaned; original catalog/configuration data preserved by existing harness assertions. Automated E2E is distinct from human manual QA.

## Known issues, documentation and checkpoint

The first integration attempt caught a fixture response-union typing error before tests ran; corrected. Added lock-timeout coverage then exposed Prisma7 adapter-pg SQLSTATE under meta.driverAdapterError.cause.originalCode rather than meta.code. Mapping was corrected only in the new B16 command; unrelated technical faults remain503. Lint required a string type guard on that metadata; corrected before final regression. Temporary filtered diagnostics were removed. All final checks above PASS.

Known pg concurrent-query deprecation remains non-failing. No native Node termination occurred in the completed263-test PostgreSQL regression; D33 worker recycling remains enabled and upstream root cause is still unproven. Human manual QA/screen-reader user testing, Firefox/full browser matrix, NFR01 latency protocol, team review/full DoD, Compose/deployment and B17+ remain pending. No new decision/schema/dependency/PDF/business API/role/refund policy was introduced.

README, DEVELOPMENT_PLAN/checklist, TRACEABILITY_MATRIX and API_DESIGN §9 now link the implementation/evidence. DECISIONS remains unchanged because Q02/Q03/DR14/DR15/D28/D31/D32 already authorize this exact design. Local checkpoint message: `feat: implement BrewLite order workflow`; its hash is reported from Git after commit, rather than embedded into its own content. Stage only B16 source/test/docs/evidence, preserve generated next-env outside the commit. No push/remote/global Git config change. Recommended next task: B17 integration/invariant audit when separately assigned.
