# L01 — Loyalty Direct Redemption implementation

2026-10-14. **LOYALTY DIRECT REDEMPTION READY (technical implementation scope).**
Development migration applied after isolated proof and required automated gates passed. A07/B17 remain PLANNED.

## Approved scope and preflight

Baseline HEAD `d0c82a5d3cbb36e549d54586d94f4c388d36bcde` matches the L00 freeze.
[L00](L00_LOYALTY_REDEMPTION_CONTRACT.md) and audit (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md))/D43 remain
authoritative: Z01/B,D01/A,S01/B,A01/B USER APPROVED. No new business choice,
voucher/campaign/manual point grant/cash refund or Order graph edge.
Initial diff only frontend/next-env.d.ts, preserved byte-for-byte/excluded from commit:
SHA256 `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`.
PDF SHA256 `08EFC9A6CC247123500419F01160C76712EC773AFFC998D2193F2873EF5312CC`, unchanged.
Seven prior migrations verified finished; public preflight4 Users/17 Orders/9 Payments/
9 Awards/28 claims, zero balance/Payment-amount/multiple-unpaid anomalies. Read-only
old-column fingerprints captured before migration; no credentials/records in evidence.

## Schema, migration and preservation

Append-only `20261014090000_loyalty_redemption`: User.loyaltyDebt BIGINT default0;
Order redeemedPoints/loyaltyDiscountAmount/redemptionState/reservationCycle defaults
0/0/NONE/0; two approved enums, one loyalty_entries table. Exact defaults/nullability,
legal Order state pairs/total equation/100*r, nonnegative A/D and A=0 OR D=0,
source/cycle/nominal-delta CHECKs, canonical source keys, FK RESTRICT/CASCADE,
effect/order-kind-cycle/terminal UQ and sequence indexes follow L00 §17. Signed CHECK
arithmetic casts before negation and uses NUMERIC where BIGINT overflow is possible.
No change to applied migrations, Payment/Award/Idempotency models or existing prices.

Migration transaction inserts only actual OPENING per pre-existing User. It does not
recreate old earns/spends, change balances/award points/reversedAt/Order amounts/
Payments/claim bodies or timestamps. New Users have implicit opening0.
Isolated legacy fixture verifies all old columns, defaults/opening/constraints and
subsequent real legacy cancellation. Forced DDL collision proves full migration
rollback without partially added fields. Development apply requires paused writers,
successful isolated proof, before/after old-column fingerprints and original migration
row/checksum verification. Never reset/seed/rewrite historical development fixtures.

## Pricing and lifecycle

Existing B09 Product/Size/Topping pricing and B13 one fixed Promotion remain intact.
Server computes subtotal -> capped Promotion -> redeemedPoints*100 -> finalTotal;
earnedPoints=floor(finalTotal/10000). Example100000-10000-50*100=85000, earn8.
Points integer0..2147483647; invalid/insufficient/exceeds-total/debt reject explicitly.
No Product/Item price change, silent clamp, preview lease or quote-created Order.

PENDING reserves A/stock and journals RESERVE/cycle1. SUCCESS settles R once and
awards from frozen total, credits debt first, journals SETTLE/EARN and clears purchased
Cart in the same Payment transaction. FAILURE releases R/stock once, journals RELEASE,
retains Cart and snapshot, no award. Retry reacquires exact original points/stock,
advances cycle once per committed attempt; never reprices or reevaluates Promotion.
Old keys replay historical bodies without additional effects or cycle increments.

Zero finalTotal still PENDING until explicit WALLET/CARD Mock Payment. SUCCESS amount0
awards0; FAILURE amount0 releases, no award. No automatic PAID or cash refund.
Unpaid cancellation releases held points/debt first and stock; FAILED cancellation
does not release twice. Eligible ADMIN PAID cancellation refunds exact r, reverses
original stored Award.points/reversedAt once, restores stock and keeps Payment/paidAt/
financial snapshots. Compute refund/reversal exactly and persist bounded final A/D
once, including valid intermediate available overflow. Preparation/completion changes
no points/journal/stock/Payment effects.

## Debt, journal and concurrency

Available A is existing INTEGER, debt D nonnegative BIGINT, held R derived from Orders.
Credits offset=min(D,credit), then available credit; reversal consumes available first
and records explained remainder as debt. Unexplained counter/source corruption503,
never automatic repair/forgiveness. Journal kinds are exactly OPENING/RESERVE/SETTLE/
RELEASE/EARN/REFUND/REVERSE; debt created/offset are deltas on their attributed events.
No redundant debt event, held counter, debt-lot table or independent idempotency engine.

Reconcile full owner journal, cycles/sources/Awards/Payments/held Orders before mutation:
A=sum availableDelta, D=sum debtDelta, R=sum reservedDelta=sum held Orders;
A+R-D=opening+earned-spent+refunded-reversed. Append-only SQL guard rejects ordinary
UPDATE/DELETE. Read-only CLI `npm.cmd run loyalty:reconcile --workspace backend`
requires backend build/local demo/test DB; consistent snapshot, reports counts only,
exit nonzero on mismatch, no repair. Business APIs never expose journal mutation.

A paid award reversed while B holds points leaves B reservation/snapshot intact.
Positive-point Payment rejects409 LOYALTY_REVERSAL_OUTSTANDING after owner lock and
proof, BEFORE mock/Payment/stock/settlement/committed claim, in both mock modes.
Existing Customer unpaid cancel releases to debt, restores stock and unlocks D31.
If debt remains, a new r0 cash purchase may earn toward it. No new edge or self-financing
from B's expected award. Cash-only retry is permitted while debt remains.

Lock order owner User -> existing Order -> Product IDs ascending CAS; owner lock
before FK-bearing claim/journal inserts. Actor for paid cancellation is Customer owner,
not Admin; A06 actor/namespace unchanged. Q19 preserved50/400/200/300ms; no blind retry.
Recognized adapter-pg lock/deadlock faults map sanitized409, invariant/bounds503.
All counters/Order/version/stock/Cart/Payment/Award/entry/claim/result roll back together.

## APIs and frontend

CUSTOMER JWT/current DB role and ownership enforced on preview/create/pay/balance/
history. POST /orders/preview200 READ ONLY RepeatableRead, no stock/points/Order/Payment/
entry/claim write. POST /orders optional redeemedPoints default0; new Order/Payment
DTOs additive per L00 §18. GET /loyalty retains loyaltyPoints, adds reservedPoints,
outstandingReversalPoints string and pointValueVnd:"100". Operator reads add snapshot
fields only; STAFF UI01 scopes and A03 ADMIN cancellation authorization unchanged.

GET /loyalty/transactions own journal only; strict empty body/query limit1..50/default20,
opaque owner-bound AES-256-GCM/HKDF cursor, frozen upper sequence/exclusive position,
sequence DESC. No OFFSET/unlimited query or sensitive fields.401 JWT/403 role,
400 malformed/foreign/tampered cursor,503 technical; empty200. New commits above U
appear on refresh; page boundaries may split two records of one committed cancellation.
History projection derives debt offset/creation from real deltas; balance is never a
page sum. Existing no-store/Vary/error envelope conventions retained.

Checkout defaults0, explicit maximum, debounced/abortable server quote, combined
discount/earn preview, immutable confirmed summary and explicit zero Payment step.
Known stale/debt errors retain selection; retry context preserves points/key/body,
lost responses retain original request. Known debt Payment409 clears uncertain-payment
context so existing cancel is available. Cancellation starts a separate new choice0.
/loyalty displays available/held/debt/rate and real nominal/actual-change history,
loading/empty/error/load-more/refresh, account isolation and cursor restart. No vouchers.

## Technical findings and verification boundaries

Legacy SQL-created TIMESTAMPTZ versus adapter Date handling exposed a timezone mismatch
at reversedAt CHECK and inconsistent read projections. Connection/session UTC now
applies consistently to reads/writes without updating stored historical timestamps.
Isolated adapters retain search_path in the same connection URL options; lock targets
are verified by actual PostgreSQL barriers. This is a technical correctness fix,
not a business policy or global PostgreSQL/Git configuration change.

Legacy tests that changed an Award after a journal EARN were converted to valid
pre-cutover Award/OPENING fixtures; original-value reversal assertions retained.
Old DTO whitelists extended with approved fields, no assertions/rules disabled.
Browser financial fixtures remain until verified owned UUID schema teardown; no
journal guard bypass or public-row cleanup. Old phase screenshots/evidence retained
under distinct L01 prefix. Browser preview/mutation error timing is tested separately.

Final evidence: backend363/363 unit/HTTP tests, frontend191/191, PostgreSQL434/434
across18 suites (44 dedicated L01 tests), both lint/build PASS, Prisma format/validate/
generate PASS and8 migrations up to date. Real Edge155.0.4283.45 on Next3100/Nest3101/
owned UUID PostgreSQL schema passes31 regression groups including L01; runtime/hydration
issues0,390/768/1366, keyboard maximum action/labels/focus/dialogs/loading/errors.
Owned schema dropped, all public development table fingerprints unchanged by E2E.

Development migration then applied: old columns across all15 business tables unchanged,
original7 migration rows/checksums/files retained,4 actual OPENING rows, debt0,17 old
Orders r/l/cycle0,NONE, no synthetic history. Read-only reconciliation4 Users,
mismatches0/repairs0. No reset/seed/development fixture modification or repricing.
Evidence: regression and58-group matrix (evidence kiểm thử cũ đã dọn),
migration (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), real browser (evidence kiểm thử cũ đã dọn).

58 L00 groups mapped individually:57 automated implementation groups PASS; R06 records
external QA/performance boundaries, not a fabricated human/Firefox/screen-reader result.
Existing pg concurrent-query deprecation remains a tooling warning; expected injected
faults emit sanitized test logs. No runtime/hydration warnings in final Edge acceptance.
Transient test/helper failures were fixed and rerun; constraints/tests were not disabled.
Local feature commit is created only after the final documentation/scope/secret checks;
actual hash is reported from Git, not embedded into the committed document itself.
Human QA/Firefox/screen reader/full team DoD/NFR01 are not inferred from automation.
A07 design remains compatible, not implemented or started; B17 remains PLANNED.
