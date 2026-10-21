# P01-B2A-FIX01 — Loyalty gateway attribution amendment

Authority: user approved additive gateway-attempt attribution on 2026-10-17.
Baseline `b6518bccd2eff81357dc3d66fbb20cdab5c2ff81`.
The original approval covered isolated validation. The user subsequently approved
controlled development apply, verification and a local commit. **The exact tested
migration is now applied; P01-B2A APIs remain outside this approval.**
[Current development apply report](P01B2A_LOYALTY_ATTRIBUTION_AMENDMENT.md).

## Conflict and exact existing invariants

[Blocker B2A-01](P01B2A_VNPAY_INITIATION_IMPLEMENTATION.md) remains byte-exact as
the original audit. [P00 §5/9](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md) requires
gateway retry reservation to commit before redirect, without terminal Payment.
[L00 §17](L00_LOYALTY_REDEMPTION_CONTRACT.md) and the
[L01 migration](../backend/prisma/migrations/20261014090000_loyalty_redemption/migration.sql)
require `loyalty_entries.payment_id` for RESERVE cycle>1:

| Object | Existing rule |
| --- | --- |
| loyalty_entries_attribution_check | Initial RESERVE: cycle1, NULL Payment, CREATE_ORDER key; retry RESERVE: cycle>1, non-NULL Payment, PAY_ORDER key |
| loyalty_entries_payment_id_fkey | Immediate RESTRICT FK to payments.id; future Payment UUID cannot satisfy it |
| loyalty_entries_effect_key_kind_key | One effect per source/kind |
| loyalty_entries_order_id_kind_cycle_key | One effect per Order/kind/cycle |
| loyalty_entries_terminal_effect_key | SETTLE/EARN/REFUND/REVERSE at most once per Order/kind |
| loyalty_entries_immutable | No journal UPDATE/DELETE |

Mock [B11](B11_PAYMENT_CONTRACT.md) retry resolves a synchronous terminal Payment
before inserting its FK-bearing journal in the same transaction. Gateway cannot
do that before an authenticated outcome. No fake Payment, prior-Payment reuse or
relaxed anonymous source is permitted by this amendment.

## Additive source model

Add `LoyaltyEntry.paymentAttemptId` → `payment_attempt_id UUID NULL UNIQUE`,
RESTRICT/CASCADE FK to PaymentAttempt.id; add the inverse navigation only.

| Effect | Immutable source after amendment |
| --- | --- |
| Initial RESERVE, cycle1 | Unchanged CREATE_ORDER:<orderId>; both Payment and Attempt NULL |
| Mock retry RESERVE | Unchanged PAY_ORDER:<paymentId>; Payment present, Attempt NULL |
| VNPAY retry RESERVE, cycle>1 | GATEWAY_ATTEMPT:<attemptId>; Attempt present, Payment NULL |
| Verified failure RELEASE | Existing PAY_ORDER:<terminalPaymentId>, Attempt column NULL; Payment.gatewayAttemptId must equal the RESERVE source for that cycle |
| Verified success SETTLE | Same terminal linkage as RELEASE, with SUCCEEDED Payment |
| EARN | Existing terminal Payment source, unchanged amount/floor rule |
| Unpaid cancel / REFUND / REVERSE / OPENING | Existing source semantics unchanged; Attempt column NULL |

Only RESERVE can use the new column. The CHECK retains the complete original
predicate behind `payment_attempt_id IS NULL` and adds one explicit XOR branch
for gateway RESERVE. Both sources together, missing source at cycle>1, wrong kind
or arbitrary effect key are invalid. Initial reservation is not retrospectively
attributed to an Attempt. A later Payment links through its existing unique
`gateway_attempt_id`; **the original RESERVE row is never updated**.

## Candidate SQL and enforcement boundary

Candidate13: `20261017020000_loyalty_gateway_attribution`, after the12 applied
migrations. No old migration changes, row DML, backfill or ledger edits.

- Atomic replacement of only the attribution CHECK, with legacy predicate intact;
  the replacement is validated in the same ALTER/transaction. No constraint or
  trigger is disabled and no unvalidated interval is exposed.
- New nullable Attempt FK and unique index: at most one gateway RESERVE per Attempt.
- New partial UNIQUE(order_id,cycle) for RELEASE/SETTLE: a cycle cannot have both.
  Existing source/kind/cycle/terminal indexes, delta/bounds CHECKs, FKs and journal
  immutability remain intact.
- Insert trigger checks Order owner, Attempt Order/provider/amount and PAY_ORDER
  claim owner/Order. New RESERVE requires current PENDING/RESERVED Order, exact
  positive points/current cycle>1, AWAITING/PENDING Attempt without terminal
  Payment/verified receipt, and a preceding failed release cycle.
- Gateway terminal journal checks terminal Payment owner/Order/amount/claim,
  its linked Attempt APPLIED with matching outcome and verification/application
  timestamps, and a VERIFIED processed receipt. SETTLE/RELEASE must match the
  immutable reserve source/current cycle/points and appropriate Order state.
  Cycle1 accepts its unchanged creation reservation; a Mock retry source cannot
  be silently converted into a gateway reservation source.
- Any pending/review Attempt or unprocessed VERIFIED receipt blocks insertion of
  RELEASE/SETTLE, including a legacy unpaid-cancel release path. UNKNOWN never
  means failure; REVIEW cannot be settled through these entries.
- Once a VNPAY Payment is referenced by journal, an UPDATE trigger freezes that
  terminal financial row, including gateway binding. Mock Payment behavior is
  unchanged. Existing journal FK/append-only rules retain source history.

These are insert-time structural guards, **not provider authentication or a full
accounting engine**. Database VERIFIED labels cannot verify HMAC or correct
provider outcome mapping. Application transactions must enforce trusted evidence,
all REVIEW/unprocessed-receipt gates, previous verified/APPLIED failure eligibility,
immutable snapshot stock OCC, exact balance/debt deltas and complete financial
atomicity. A structurally valid row is not permission to call an external gateway.

## Transaction and locking behavior

Future callers must keep owner User → Order → Attempts ID ASC → claim/related rows
→ Products ID ASC. No network calls inside a transaction, independent accounting
commit or blind retry. Existing runtime transaction budgets are unchanged; larger
timeouts in isolated fixture setup are test-only.

Retry initiation checks reconciliation, previous verified/APPLIED failure and debt/
stock/points. In one transaction it creates the claim/Attempt, reacquires snapshot
stock once, advances cycle once, sets PENDING/RESERVED, appends Attempt RESERVE and
persists exact counters plus completed replay response. Existing PROCESSING claim
requires NULL order_id; bind Order/completed response before the RESERVE insert
guard, all within the same transaction. Do not change that old idempotency CHECK.

T1 verified receipt semantics stay P00. Future T2 locks/rereads and validates the
receipt outside this amendment's runtime scope. Within one T2 transaction, terminal
Payment, Order state, Attempt APPLIED and processed receipt must be set before
appending terminal journal entries so the insert guards see a consistent outcome.
RESERVE retains Attempt source; SETTLE/RELEASE use the matching terminal Payment.
EARN/Award/Cart/stock/counter changes remain exactly the existing P00/L01 effects.

If any T2 write fails, every T2 effect and processed marker rolls back; the prior
T1 receipt remains pending for safe recovery. A failed initiation rolls back claim,
Attempt, cycle, stock, journal and balances together. Unique source/cycle keys and
owner locks prevent duplicate reservation/outcome; same-key replay does no writes.
No local expiry release, forced settlement, snapshot rewrite or debt repair.

## Isolated implementation boundary

The accounting helper gains an optional Attempt source for RESERVE only and checks
mixed sources before mutating its in-memory account. Reconciliation reads Attempts
and verifies any terminal Payment matches a gateway reservation source. It does not
introduce an initiation/settlement writer, controller, IPN or provider activation.
Existing Mock callers do not pass the new source and retain their exact keys.

During isolated validation, root generation/build/deploy were deferred while
source was ahead of development. The later explicit apply approval authorized
migration13 and coordinated root client/build regeneration. Current root schema
and client now match development; PostgreSQL fixture writes still use isolation.

## Validation requirements and limitations

New tests simulate transactions only inside an owned random schema in an explicitly
allowed local FIX01 database. Synthetic VERIFIED receipts model trusted persistence;
they are not genuine provider messages or Sandbox PASS. Test-only outcome helpers
are not imported by AppModule or production services.

Required coverage: Attempt-only retry RESERVE; legacy Mock source; XOR/owner/Order/
cycle/source rejection; same/different-key concurrency; one stock/points reservation;
rollback with no orphan; verified failure/success once; immutable journal/Payment
binding; UNKNOWN/REVIEW holds; unchanged historical tables and full financial suites.
Execution counts, hashes, backup/restore and preservation are recorded in
FIX01 evidence (evidence kiểm thử cũ đã dọn) after checks complete.

No100 VND rate, promotion order, earned-points formula, debt/refund/reversal policy,
Order graph or Mock historical meaning changes. P00/L00/L01/B11/B16 source contracts
remain untouched; this approved additive source extension is recorded separately.
Cross-table guards do not replace application ownership/financial reconciliation.
No actual Sandbox, browser, IPN, settlement, merchant setup or ingress validation.

## Final isolated execution result

**P01-B2A-FIX01 ISOLATED PASS — AWAITING DEVELOPMENT APPLY APPROVAL**

| Gate | Actual result |
| --- | --- |
| Fresh backup | D:\BrewLite-backups\FIX01-20261017T014018Z; protected ACL, exported read-only snapshot,7 manifest files/hashes and Git bundle verified |
| Restore | Final brewlite_fix01_35318ccc7a4b_test;19 tables/full12 ledger/catalog exactly match backup before candidate |
| Candidate13 | 20261017020000_loyalty_gateway_attribution; isolated deploy/status up to date, Prisma diff0 |
| Prisma validate/generate | PASS,7.10.0; generation isolated only |
| Attribution PostgreSQL | 14 tests PASS, including no fake current Payment, XOR/owner/Order/cycle, concurrent/replay/rollback, source immutability, UNKNOWN/REVIEW and verified synthetic outcomes |
| Full PostgreSQL | 20 suites/492 tests PASS, no failed/pending; includes44 L01 redemption,43 Payments,49 Order workflow and14 attribution tests |
| Full backend unit/HTTP | 16 suites/481 tests PASS, no failed/pending |
| Isolated lint/typecheck/build | PASS, exit0 |
| Historical isolated data | All18 business-table old-column fingerprints match backup; new attribution NULL on all9 historical journal rows; empty public gateway tables |
| Original SQL/catalog | All12 original ledger rows/checksums, columns, indexes, triggers, functions, enums and sequence values retained; only attribution CHECK replaced with its preserved legacy branch plus extension |
| Development final audit | READ ONLY; all19 full fingerprints/catalog/full12 ledger unchanged |
| Protected pending work | Original blocker document and next-env byte-exact; existing development-plan bytes preserved as prefix with an appended FIX01 checklist |

The draft databases brewlite_fix01_73aff5afe1d1_test and
brewlite_fix01_05487dde878f_test are retained for audit. After adding terminal Payment binding immutability, the final candidate
was deployed to a new fresh restore; no migration ledger was patched. An early
test-fixture PROCESSING-claim shape was corrected to obey the existing result CHECK.
Neither correction changed Mock business rules or old migrations. The final SQL
was normalized to LF for stable source hashes, applied to a new fresh restore,
and the full492 PostgreSQL tests rerun successfully. No applied ledger was edited.

Evidence JSON records exact candidate/schema hashes and check exits. Future apply
must revalidate those hashes, Git/source scope, database identity/ledger/drift,
backup freshness and writers before deploying only this candidate and regenerating
the compatible root client/build. No development apply approval is inferred here.
No commit/stage/push or subsequent API/IPN work was performed.

## Subsequent controlled development apply

The isolated execution section above is the preserved prior checkpoint.
Development apply was subsequently explicitly approved and completed:13 migrations,
matching candidate hashes, no Prisma diff, historical19 projections preserved,
root client/build regenerated,481 unit/HTTP and492 PostgreSQL tests PASS.
Read-only reconciliation checks4 Users with0 mismatches;191 frontend tests and both
lint/typecheck/build PASS. Original blocker content and next-env remain byte-exact.
[Current report](P01B2A_LOYALTY_ATTRIBUTION_AMENDMENT.md) records exact execution boundaries.
No change to the technical amendment above, P00/L01 business rules or gateway mode.
