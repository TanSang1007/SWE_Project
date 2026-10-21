# P01-B2B — VNPAY IPN verification and financial settlement

2026-10-17. **P01-B2B COMPLETE — READY FOR RECONCILIATION**.
Baseline `ed56e30e1752eeb7c9ba8385a4fa53d562529322`. Current implementation supersedes earlier checkpoint
statements that IPN remains unimplemented; previous phase reports stay historical.
[P00](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md) and
[FIX01 amendment](P01B2A_LOYALTY_ATTRIBUTION_AMENDMENT.md) are unchanged.

## Scope and files

Public GET /payments/vnpay/ipn is registered in PaymentModule through IpnController/
IpnService. vnpay/ipn-verification.ts composes P01-A raw parser, timing-safe HMAC,
canonical PAY verification and conservative mapping. configure-app rejects framed
GET bodies before JSON parsing, including malformed/oversized JSON and equivalent
case/trailing-slash route spelling. Attempt status reads additionally recognize
verified success evidence behind REVIEW even when an older FAILED result is retained.
No new schema/migration/package, Mock business formula or frontend source change.

## Authentication and validation

No JWT/session/cookie is required or used for provider authorization. Parse original
raw query once with P01-A multimap parser: bounds8KiB/30 keys, strict percent/UTF-8,
decoded duplicate/nested/control rejection. Explicit PAY2.1.0 whitelist; unexpected
fields are rejected, never removed before authenticating a different signed message.
HMAC-SHA512 uses pinned canonical encoding, hex128/64 bytes and timingSafeEqual;
HashType cannot downgrade. Missing/bad signature or wrong configured merchant97.

After provider authentication, resolve known immutable txnRef (unknown01), verify
exact minor string from Attempt amount (mismatch04), currency VND/context, callback
OrderInfo and P01-A semantic/date/transaction-number checks. Rebuild unsigned
initiation snapshot under current fixed Sandbox config and validate claim owner,
Order, PAY_ORDER action/hash, completed201 and response identity under locks.
No callback total, price, owner, URL or state can rewrite server snapshots.

Mapping stays P01-A/P00:00/00 + valid nonzero number→SUCCEEDED; status02 with only
09/10/11/12/13/24/51/65/75/79→FAILED; status01→UNKNOWN except fraud07→REVIEW.
Contradictory/unsupported valid code pairs→REVIEW. Invalid field syntax→99 without
receipt. Failure0/zero-only number is retained as evidence but NULL on Attempt,
never a shared unique provider transaction ID. Nonzero leading digits are strings.
PayDate is calendar-validated UTC+7 and stored separately; paidAt/confirmedAt are
local settlement time. Local expiry never rejects authentic late success.

## T1 — durable verification receipt

Provider syntax/HMAC authentication precedes DB mutation. In a short transaction:
read lookup → owner User FOR UPDATE → Order → all Order Attempts ID ASC → receipts
ID ASC → original claim; reread immutable bindings. Insert/deduplicate VERIFIED IPN
receipt by attempt/source/SHA256(canonical verified unsigned message). Commit T1
before invoking T2. T1 never changes Attempt result, Payment, Order, Cart, stock,
Award or Loyalty journal/balances. Receipt hash excludes signature/HashSecret;
stored payload is only normalized allowlisted merchant/ref/minor/codes/txnNo/bank/
PayDate. Raw query, BankTranNo, CardType, headers and signed URL are not stored.
Different auxiliary signed fields can produce a new receipt with equivalent money
semantics; it is consumed without repeating financial effects.

## T2 — atomic internal financial effects

Use the same owner→Order→Attempts→receipts/claim locks and reread all verified
evidence for the Attempt, including processed history. Check other Order REVIEW/
unprocessed receipts, selected terminal result, provider number uniqueness, latest
Attempt, Order PENDING, no prior success/Award, reservation cycle and full account
proof. Contradictions never overwrite an already applied financial result.
Each T retains50ms maxWait/400ms timeout, lock200ms/statement300ms. No network,
blind financial retry, queue, scheduler or increased timeout.

Success atomically writes bound VNPAY Payment SUCCEEDED/original initiation claim,
Order PAID/version/local paidAt, Attempt APPLIED/provider fields, receipt processed,
SETTLE exact held cycle, unique floor(total/10000) Award/EARN/debt-aware balance,
and purchased Cart qty removal. Extra qty/other owner data remain. No stock debit
again and no promotion/catalog repricing. Provider result alone never fakes PAID.

Failure atomically performs sorted snapshot Product stock/version CAS restore,
Payment FAILED/VNPAY_DECLINED, PAYMENT_FAILED/version, exact-cycle RELEASE debt-first,
Attempt APPLIED and receipt processed; Cart/snapshots remain, no Award. Positive
debt arising after initiation does not call reservationGate on verified failure:
RELEASE offsets debt according to unchanged L01 formulas. This is P00 D07's approved
orchestration difference from Mock, not a new accounting rule.

FIX01 requires Attempt APPLIED and receipts processed before journal INSERT. These
writes occur inside the same T2 transaction before terminal journal effects, so
any later failure rolls back all of them. Gateway retry RESERVE source remains its
immutable paymentAttemptId; SETTLE/RELEASE uses the terminal Payment pointing to that
same Attempt/cycle. No attribution rewrite or fake terminal Payment at initiation.

## UNKNOWN and durable REVIEW

UNKNOWN keeps PENDING application and reservations, stores verified provider fields,
leaves receipt unprocessed and returns99 because no APPLIED/REVIEW outcome exists.
Duplicate UNKNOWN stays99; later verified terminal outcome consumes compatible
provisional receipts atomically. UNKNOWN is never failed from local time or tab close.
A new UNKNOWN after an applied terminal result is a retained conflict REVIEW.

Semantic exceptions rollback financial T2, then commit a separate locked REVIEW
transaction with reason and processed evidence. Reasons cover contradictory outcome,
cancelled/already-paid/other-attempt state, debt blocking positive settlement, bad
Cart/account/stock/reservation bounds and foreign provider transaction number.
Foreign number is retained in receipt, not assigned to the second Attempt. Known nonzero identifiers cannot be rebound; normalized verified evidence also blocks reusing an additional identifier retained only in REVIEW. A unique
race is converted to REVIEW only after rereading an actual durable foreign binding;
other unique/technical errors remain99. REVIEW write failure also returns99.
Existing Payment/Award/journal/stock/Order are preserved; no force-settle/refund.
Old failed Attempt receiving success becomes REVIEW and status reports
PAYMENT_RECEIVED_REVIEW from evidence. A newer pending Attempt keeps its resources;
all-attempt/receipt guards block another charge/cancellation. REVIEW is not success
of local fulfillment and cannot be used for customer retry.

## ACK, deduplication and recovery

| HTTP200 RspCode | Condition |
| --- | --- |
|00|APPLIED or deliberate REVIEW durable commit; first resolution, not necessarily PAID|
|02|Equivalent notification already consumed with durable application/review; no repeated effects|
|01|Authenticated merchant/signature, unknown reference|
|04|Known bound reference, wrong exact amount|
|97|Missing/invalid HMAC or wrong merchant|
|99|Malformed/unsupported/body input, gate OFF, UNKNOWN hold, T1/T2/lock/DB failure without durable resolution|

Messages are fixed/sanitized, no generic app error envelope. Cache-Control:no-store.
No raw callback/signature/secret logging. Rejections emit at most one fixed sanitized diagnostic per minute per service instance. HTTP transport can reject structurally
invalid HTTP before Nest; the provider ACK contract applies to accepted GET requests.

T1 failure has no receipt/effects. T1 commit + T2 crash leaves an unprocessed receipt;
same signed IPN runs T2 again, not premature02. Technical T2 failure rolls back all
financial writes/processed markers;99 asks provider to retry. Lost ACK after commit
replays02. Concurrent identical callbacks converge to one local effect set.
Conflicting refs claiming one provider number can both enter REVIEW if both durable receipts
are visible before application; at most one may apply, never two settlements.
Conflicting callbacks retain both evidence and REVIEW, including success-after-failure or failure
after-success; no downgrade, double stock restoration, Award or Cart clear. Internal
uniques plus locks establish nonduplicated local effects, not exactly-once external
charge. Later reconciliation must provide an approved consumer; no scheduler added.

## Runtime feature gate and preservation

P01-B2A gate is unchanged: default MOCK requires no merchant credentials; VNPAY
config only valid for explicit synthetic NODE_ENV=test, matching loopback isolated
brewlite_b2a_<12hex>_test URLs, TEST0001/synthetic fixture namespace/callback.example.org.
B2B reuses this strict DB namespace rather than adding an enable switch. Callback
OFF returns99 before database access. No Customer input toggles provider; Mock POST
still403 when gated and original behavior/replay remains in MOCK. No actual merchant
secret, external VNPAY call, public ingress/tunnel or development synthetic record.
Tests clone a verified FIX01 isolated snapshot; never restore/overwrite development.

## Current verification

| Check | Result |
| --- | --- |
|Backend unit/HTTP|535/535,18 suites =501 baseline +34 IPN tests|
|Real PostgreSQL|587/587,22 suites =528 baseline +59 IPN tests|
|Frontend|191/191; build from source copy preserves unrelated next-env|
|Both lint/typecheck/build|PASS|
|Prisma validate/status/diff|PASS,13 completed/checksum-matching, up to date/no difference|
|Development preservation|READ ONLY, all19 full fingerprints/catalog/ledger unchanged|
|Actual merchant Sandbox / E2E|NOT RUN; no actual profile/callback/bank verification claimed|

PG assertions cover T1 durability and failure, all T2 financial write fault points,
review commit failure, exact replay/concurrent/contradictory callbacks, foreign
transaction-number races, retry/cancel races, ownership/claim/context, FIX01 cycle2,
debt-aware failure RELEASE, positive debt success REVIEW, cash-only debt EARN, Cart
extras, paid cancellation and late success. Fault tests retain T1, roll back financial
state, then retry successfully once; no constraints were weakened to pass.
Mandatory example:100000 subtotal − BREW10K10000 −50 points×100 =85000 VND;
minor8500000, Award8, journal RESERVE50→SETTLE50/EARN8, available58/held0/debt0,
stock remains originally reserved9. Failure restores10 and available100 exactly once.

Machine evidence (evidence kiểm thử cũ đã dọn) records checks, source hashes, isolated
identity and before/after19 fingerprints. Existing Mock/B04–B16/A00–A06/L00/L01/
inventory/Promotion/idempotency suites all remain; no skipped baseline suites.
Baseline test-harness pg concurrent-query deprecation and sanitized fault logs are
non-failing warnings. No browser E2E or NFR latency certification claimed.

## Remaining prerequisites

QueryDr/reconciliation/admin review tooling, Return resolver, zero-total completion,
Checkout integration and explicit activation approval remain separate tasks.
Actual merchant decline fixtures/callback ingress/Bank Sandbox are NOT VERIFIED.
UNKNOWN/REVIEW can hold resources/Cart indefinitely by frozen contract; no manual
force-paid/refund/release shortcut. Local commit only after gates pass, no push.
P01-B2C may be assigned next; this task stops after report.
