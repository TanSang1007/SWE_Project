# A06 — Admin Inventory Management

2026-10-13. **INVENTORY MANAGEMENT READY (technical user scope).**

## 1. Approved scope

USER-APPROVED EXT-AS06 and D42. ADMIN Product available-stock management only.
Two append-only enum/CHECK migrations approved explicitly, verified in an owned
PostgreSQL schema before development deploy. No ingredient/recipe/branch/ledger,
reporting, A07/B17 implementation or customer redesign. Initial HEAD and audit
references are preserved in the historical pre-flight below.

## 2. Requirement mapping

EXT-AS06 → FR14/NFR06/10, authorization NFR02, interface NFR04/05,
AS-T11–12/14 and preservation AS-T15. Availability reuses FR01/02/06 and BR09/10/11.
These are extension/reuse mappings, not additional PDF FRs. PDF reread8 pages with
standard-library font mapping; baseline hash unchanged, no package installation.

## 3. Inventory semantics

Stock is available Product quantity shared by sizes. PENDING already claims it;
payment success never subtracts again; failure restores; retry reacquires snapshot
quantities; PAID cancellation restores via B16. Adjustment adds a delta to remaining
available stock, not historical intake or held Order consumption. isActive toggle
never changes stock. Inactive/zero stock/missing active size/unavailable stay distinct.

## 4. Implemented API contracts

| Method/path | Exact input / output |
| --- | --- |
| GET /admin/inventory | Empty query/body;200 `{items:[{productId,productName,stock,version}]}`; all Products, ID ASC, no filter/search/pagination |
| POST /admin/products/:id/inventory-adjustments | UUID, mandatory Idempotency-Key, only `{delta,expectedVersion}`;200 `{productId,delta,previousStock,stock,version}` |

The A00 path takes precedence over the provisional stock-adjustments spelling.
GET is read-only. Private/no-store/Vary Authorization/Origin, existing CORS and
Idempotency-Replayed exposure. Existing sanitized error envelope retained.
400 VALIDATION_ERROR/MISSING_IDEMPOTENCY_KEY;401 UNAUTHORIZED;403 FORBIDDEN;
404 PRODUCT_NOT_FOUND;409 CONCURRENT_UPDATE/INVALID_STOCK_ADJUSTMENT/
IDEMPOTENCY_KEY_REUSED/IDEMPOTENCY_IN_PROGRESS;503 SERVICE_UNAVAILABLE.

## 5. Authorization

JWT before explicit ADMIN RolesGuard, DB role every request before lookup/replay.
STAFF/CUSTOMER403 even forged JWT role; guest/invalid/expired/deleted-user401.
Demotion affects the next request and prevents old-key replay. No public/debug route.
Frontend guards/navigation are UX; backend independently enforces these permissions.

## 6. Delta and expectedVersion

Integer nonzero delta -2147483647..2147483647; required expectedVersion integer
0..2147483647, no string coercion. Reject absolute stock/actor/userId/reason/unknown
fields/query/version injection. UUID lowercased before hash; header1..128 visible
ASCII via existing helper. New Product still stock0/version0/default active.

## 7. Product.version OCC

Original supplied version is checked and used in updateMany `{id,version}` CAS.
Stock increment(delta), version increment1 and updatedAt are atomic. Stale/CAS0
returns409 and rolls back. No automatic expectedVersion replacement or mutation
retry. Replays bump zero times. B10/B11/B16/A04/A05 share the same token unchanged.

## 8. Persistent idempotency

Reuse IdempotencyRequest/UQ/helper. Scope authenticated admin + ADJUST_INVENTORY +
key; canonical SHA256 operation/productId/delta/expectedVersion, not prices/time/JWT.
Same normalized request replays stored status/body before current Product/version/
stock checks, including after later changes/deletion. Different product/delta/version
conflicts; another admin scope is independent but still uses Product OCC. Replay is
historical; GET is current. Internal key/hash/claim data never appears in result DTO.

Two migrations:20261013190000_inventory_operation commits enum addition before
20261013190100_inventory_result uses it. PROCESSING fields remain NULL; COMPLETED
status/body/completedAt required; inventory order_id NULL; CREATE_ORDER/PAY_ORDER
order_id NOT NULL and valid FK. Status100..599/UQ/FK/other CHECKs preserved.
Validation/business/technical errors roll back a new claim; no PROCESSING standalone
commit, no TTL cleanup/new table/ledger/independent subsystem. Original payment
failure result persistence remains unchanged.

## 9. Transaction and lock order

Existing maxWait50ms/deadline400ms/lock200ms/statement300ms: scoped replay lookup →
ADMIN user-row lock before claim FK → reread claim → PROCESSING → Product read/
original version/bounds → CAS → completed200 result → commit. Stock/version/
timestamp/claim/result roll back together. No customer lock after Product, nested
B16 transaction or lock inversion; customer engines keep owner lock/sorted Products.
After technical rollback, recovery reads committed claim once in a new transaction.
Recognized unresolved contention uses409 IN_PROGRESS to retain original key/body;
explicit stale/CAS business rejection uses409 CONCURRENT_UPDATE. Never retry writes.

## 10. Numeric bounds

Result stock0..2147483647 checked before write and protected by original DB CHECKs.
No negative stock/clamp/absolute overwrite. Version max prevents increment with503
rollback; stock underflow/overflow409 INVALID_STOCK_ADJUSTMENT. No money arithmetic.

## 11. Frontend workflow

ADMIN `/admin/inventory` and sidebar `Tồn kho`. Exact inventory DTO supplies stock/
version; existing Product GET separately supplies active/inactive labels. The UI
labels that separate read and does not invent availability from phased A04 sizes.
Choose Product/increase/decrease/quantity; preview; checkbox confirmation for reduction;
labels/fieldset/status/alerts/focus, pending/ref double-submit gate, responsive table.
No optimistic success. Confirmed response followed by authoritative GET/current stock;
failed refresh distinguishes confirmed mutation and offers only read retry.

Stale409 blocks adjustments until reload and explicit review/new action; no version
replacement. Invalid reduction is explicit. Unknown response blocks a new action and
retains user/product/key/body in sessionStorage without JWT. `Khôi phục yêu cầu`
replays original request; reload/sign-in same owner resumes, other owner clears it,
wrong role cannot replay. Storage write failure prevents mutation. Success clears
context. Loading/empty/error/read retry/Forbidden/session-expired states supported.

## 12. Product creation shortcut

Confirmed A04 create shows `Đã tạo sản phẩm. Tồn kho hiện tại: 0.` and explicit
`Nhập tồn kho` link `/admin/inventory?productId=<id>`. Inventory GET preselects it;
create/open/mount never sends adjustment. No inline initial stock, combined
create/topup transaction, automatic activation or implicit size.

## 13. Order/Payment concurrency and customer catalog

Real simultaneous PostgreSQL transactions pause inventory after Product read, let
Order creation/payment failure restore/payment retry/PAID cancellation/metadata/
size/association mutation commit, then release original CAS: inventory loses409,
original engine atomicity/snapshots retained. Two-admin same-version and same-key
duplicates use concurrent requests. Existing stock/OCC inverse-race regression retained.

Catalog fetch no-store; fresh availability requires active Product + stock>0 +
valid active size. Topup never activates/creates size/repairs Cold Brew development
data or mutates Cart/history. Checkout uses DB; retry/cancellation uses snapshots.
No OrderItem/price/option/promotion/Payment/Loyalty/workflow side effects from A06.

## 14. Test evidence

Migration evidence (evidence kiểm thử cũ đã dọn): isolated apply, old completed claims/
business rows/guards preserved, inventory NULL Order allowed, original operations
NULL/invalid Order rejected, status/completion/PROCESSING/UQ protections verified
before development deploy; public fingerprints/original5 migration records unchanged.
[HTTP tests](../backend/test/admin-inventory.spec.ts):14 cases.
[PostgreSQL tests](../backend/test/database/admin-inventory.spec.ts):25 cases,
including A–W groups, normalized UUID/property-order replay, scope/deleted-resource
replay, bounds/OCC/duplicates/trigger fault after stock write/security/availability/
7 engine/config race variants. [Frontend tests](../frontend/test/admin-inventory.test.mjs):
11 parser/API/form/preview/recovery/storage/session cases; live transitions in browser.
Full regression PASS342 backend/HTTP,174 frontend,390 isolated PostgreSQL tests.
Verification summary (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)) records checks, protected
hashes, migration status and accurately unverified NFR/browser/manual limits.
Real browser evidence (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)): Edge155.0.4283.45,
owned compiled Next3100/Nest3101/PostgreSQL UUID schema,31 check groups covering
customer+A01–A05/UI01+A06,0 runtime exceptions/hydration warnings. A06 create0→shortcut→
topup10→Customer available→PENDING stock claim→safe reduction/OCC409/concurrent
OCC/duplicate replay/lost-response reload same-key/history preservation/roles/error/
recovery/session and390/768/1366 keyboard/focus/legible caption PASS. Schema cleaned,
all public-table fingerprints unchanged. Screenshots A06-inventory-390/768/1366.

## 15. Regression

B04–B16/A01–A05/UI01 retained. A04/A05 fixtures apply chronological migrations once,
preserving original phase assertions. UI01 now expects implemented Inventory and
still excludes planned Promotion. D33 worker recycling extended to default Jest
after native3221226505 termination;14 suites342 tests passed without removing any
concurrent request assertions; native root cause unconfirmed. Prisma format/validate/
generate/status7 migrations and backend/isolated Next production builds passed.
Both lint/builds PASS (frontend production build uses byte-identical owned snapshot
to preserve next-env). Final browser source includes the mobile-caption correction
verified visually and by readable-height assertion. Browser output uses A06 prefix;
historical screenshots preserved. Sanitized fault
logs and existing pg deprecation warnings are expected test output.

## 16. Remaining risks and Git

NFR01 latency/Firefox/human manual QA/screen reader/team review/Compose/full DoD
not verified. PENDING abandoned Orders still hold stock under unchanged design;
claims have no TTL, replay is historical, option lifecycle limitations remain.
Documentation links/scope/secrets/diff/hash reviewed; final local checkpoint follows
the verified staging review. Hash reported from Git/final output, no self-reference.
Exclude pre-existing next-env bytes; no push/remote/global Git configuration changes.
Requested commit: `feat: implement BrewLite admin inventory management`.

## 17. A07 dependencies

RBAC/admin/shared infrastructure available. A07 independently requires its own task,
Promotion.version/config APIs/UI/snapshot races. A07/B17 remain PLANNED; A06 does
not implement them or imply their acceptance.

# Historical pre-flight and approval gate

The following is the original pre-flight snapshot; pending/NOT IMPLEMENTED notes
below are historical and superseded by D42 and the current implementation above.

**Current update — D42 ACCEPTED USER, 2026-10-13:** both migrations approved.
Isolated verification passed before development deploy; 7 migrations now applied.
Migration evidence (evidence kiểm thử cũ đã dọn): legacy rows, original operations,
FK/UQ/other CHECKs and all public business rows preserved. Application/API/UI and
tests are IN PROGRESS; no readiness claim yet. Historical pending notes below
describe the original pre-flight stop and are superseded only by this approval.

2026-10-13. **PRE-FLIGHT ONLY / NOT IMPLEMENTED / MIGRATION APPROVAL PENDING.**
User assigned development of EXT-AS06, but task §5 explicitly requires stopping
before coding when persistent idempotency needs a new constraint. A00 §10 and
D36 already describe the minimal design below; this document requests the
implementation approval required by the current task. No migration has been
created or applied. A07 and B17 remain PLANNED.

## 1. Pre-flight evidence and sources

- Git HEAD: `0a085556995a1e5d21bc7ac64ef24dc09bd80ed0`,
  `feat: implement BrewLite admin size topping management`.
- Initial tracked change: only `frontend/next-env.d.ts`, 2 insertions and
  2 deletions. Preserve its bytes and exclude it from staging.
- `npm.cmd run db:status --workspace backend`: PASS, 5 migrations, schema
  up to date, PostgreSQL `localhost:5432/brewlite_dev/public`.
- PDF SHA256: `08EFC9A6CC247123500419F01160C76712EC773AFFC998D2193F2873EF5312CC`.
  Hash matches baseline. No PDF edit; PDF text reread is still pending before
  implementation (no installed PDF text extractor was found during pre-flight).
- No database reset, seed, migration, application change, Git commit or push.
- Source and read-only database inspection confirm the two-value enum and
  original public-schema CHECK requiring COMPLETED.order_id NOT NULL. Public
  products:4, stock/version negative violations:0. Metadata also returned two
  older test schemas; no cleanup or changes to those schemas were performed.
  This targeted inspection does not establish absence of all schema drift.

Contract references: [A00 §2–7/10/12/14](A00_ADMIN_STAFF_CONTRACT.md),
[API design](API_DESIGN.md), [database design §10](DATABASE_DESIGN.md),
[D35–D37/D39–D41](DECISIONS.md), [requirements](REQUIREMENTS.md),
[architecture](ARCHITECTURE.md), [plan](DEVELOPMENT_PLAN.md),
[matrix](TRACEABILITY_MATRIX.md), [design review](DESIGN_REVIEW.md),
[project structure](PROJECT_STRUCTURE.md), [README](../README.md),
[AGENTS](../AGENTS.md). Relevant sections were inspected; complete document
reread remains required before coding.

Dependencies: [A01](A01_RBAC_AUTH_CONTRACT.md),
[A04](A04_ADMIN_PRODUCT_MANAGEMENT_CONTRACT.md),
[A05](A05_SIZE_TOPPING_MANAGEMENT_CONTRACT.md),
[UI01](UI01_ROLE_BASED_INTERFACE_CONTRACT.md),
[B08](B08_CART_CONTRACT.md), [B09](B09_PRICING_CONTRACT.md),
[B10](B10_ORDER_CONTRACT.md), [B11](B11_PAYMENT_CONTRACT.md),
[B13](B13_PROMOTION_CONTRACT.md), [B16](B16_ORDER_WORKFLOW_CONTRACT.md).

Source references: [Prisma](../backend/prisma/schema.prisma),
[initial CHECK](../backend/prisma/migrations/20261006151833_init/migration.sql),
[idempotency helpers](../backend/src/common/idempotency.ts),
[Order service](../backend/src/orders/order.service.ts),
[Payment service](../backend/src/payments/payment.service.ts),
[Cart service](../backend/src/cart/cart.service.ts),
[Product management](../backend/src/catalog/admin-product.service.ts),
[option management](../backend/src/catalog/admin-option.service.ts),
[Product UI](../frontend/src/components/admin-products.tsx).

## 2. Pre-flight mapping

| Item | Contract / implementation plan |
| --- | --- |
| Extension and requirements | EXT-AS06; reuse FR14, NFR06/10; authorization NFR02; AS-T11–12/14 and preservation AS-T15. No new PDF requirement. |
| Approved scope | ADMIN-only Product available-stock adjustment; no ingredient, branch, ledger, reporting, A07 or B17 implementation. |
| Stock semantics | PENDING claims stock; payment success does not subtract again; failure restores; retry reacquires snapshot quantities; PAID cancellation restores snapshot quantities. isActive changes never adjust stock. |
| Existing OCC | Product.version shared by B10/B11/B16/A04/A05. Atomic updateMany predicates on id/version; increment stock by delta and version by 1 in one transaction. Stale original expectedVersion returns409 CONCURRENT_UPDATE. |
| Existing idempotency | Persistent IdempotencyRequest, unique userId/operation/key, request hash, PROCESSING/COMPLETED, response status/body. Current enum/CHECK cannot complete inventory claims without a fake Order. |
| API/DTO/errors | Exact A00 paths and DTOs below; strict whitelist, no absolute stock, no automatic business retry. |
| Database changes | Proposed enum extension and operation-aware CHECK only, two append-only migrations, approval pending. No new table/column/Product FK/ledger. |
| Authorization | JWT then DB-authoritative ADMIN role before lookup/replay; STAFF/CUSTOMER403, guest/invalid JWT401. |
| Race strategy | Admin user lock before FK-bearing claim insert, then Product CAS. Never lock a customer user after Product. Existing customer engines retain owner lock and sorted Product order. |
| Acceptance | Backend/PostgreSQL A–W, frontend and real browser scenarios, full requested regression; no READY/checklist completion until evidence exists. |

## 3. API and bounds from A00

- `GET /admin/inventory`: empty query/body,200 `{items:InventoryItem[]}`,
  Product ID ascending; no filter/search/pagination. Item exactly
  `{productId,productName,stock,version}`. Private/no-store reads.
- `POST /admin/products/:id/inventory-adjustments`: UUID parameter,
  required `Idempotency-Key`, exact body `{delta,expectedVersion}`;
  200 `{productId,delta,previousStock,stock,version}`.
- The provisional `stock-adjustments` path in the task is superseded by the
  explicit instruction to follow A00/API_DESIGN.
- delta integer, nonzero, range -2147483647..2147483647; expectedVersion
  integer0..2147483647. Result stock0..2147483647; version max prevents
  mutation with503 SERVICE_UNAVAILABLE. Do not coerce, clamp or overwrite.
- Errors:400 VALIDATION_ERROR/MISSING_IDEMPOTENCY_KEY;
  401 UNAUTHORIZED;403 FORBIDDEN;404 PRODUCT_NOT_FOUND;
  409 CONCURRENT_UPDATE/INVALID_STOCK_ADJUSTMENT/IDEMPOTENCY_KEY_REUSED/
  IDEMPOTENCY_IN_PROGRESS;503 SERVICE_UNAVAILABLE. Sanitized existing envelope.

## 4. Minimal migration proposal — pending current-task approval

Migration 1, committed before migration 2:

```sql
ALTER TYPE "IdempotencyOperation" ADD VALUE 'ADJUST_INVENTORY';
```

Corresponding Prisma enum adds `ADJUST_INVENTORY`. Migration 2 replaces only
the completion CHECK, in a transaction:

```sql
BEGIN;
ALTER TABLE "idempotency_requests"
  DROP CONSTRAINT "idempotency_result_check";
ALTER TABLE "idempotency_requests"
  ADD CONSTRAINT "idempotency_result_check" CHECK (
    (state = 'PROCESSING' AND order_id IS NULL
      AND response_status IS NULL AND response_body IS NULL
      AND completed_at IS NULL)
    OR
    (state = 'COMPLETED' AND response_status IS NOT NULL
      AND response_body IS NOT NULL AND completed_at IS NOT NULL
      AND (
        (operation IN ('CREATE_ORDER', 'PAY_ORDER') AND order_id IS NOT NULL)
        OR (operation = 'ADJUST_INVENTORY' AND order_id IS NULL)
      ))
  );
COMMIT;
```

Preserve existing UQ/FK/status100..599 CHECK and mandatory Order link for both
original operations. Inventory product identity is in request hash/response
body, not a new relation. Do not edit applied migrations. Isolated migration
tests must verify old claims and existing records/constraints before applying
to development. A failed second migration can leave the additive enum value;
do not reset/drop development data to undo it.

## 5. Idempotency and transaction strategy

Authorize, validate syntax/key, then execute one transaction with existing
maxWait50ms/deadline400ms/lock200ms/statement300ms policy:

1. Lookup committed claim by authenticated admin + ADJUST_INVENTORY + key.
2. Compare SHA256 of canonical operation/productId/delta/expectedVersion;
   matching completed request replays stored status/body before checking
   current Product existence/stock/version. Mismatch409 KEY_REUSED.
3. Lock admin user row before inserting the FK-bearing claim; reread claim.
4. Insert PROCESSING, read Product, enforce original version and checked bounds.
5. Product CAS increments stock by delta and version by1; updatedAt same write.
6. Store COMPLETED200 result with orderId=NULL, then commit all effects together.

Failures roll back claim/stock/version/result. No standalone PROCESSING commit.
Unique/recognized contention recovery reads committed replay once in a new
transaction after rollback; never retries the business mutation. Distinguish
unresolved duplicate409 IN_PROGRESS from stale business409 CONCURRENT_UPDATE.
Concurrent customer or admin writes are resolved by shared Product CAS.
Real PostgreSQL races still need verification; this is a strategy, not evidence.

Same-key replay after later version changes or Product deletion is historical;
GET retrieves current inventory. Frontend retains original user/product/key/body
in sessionStorage without JWT for unknown-response replay; account changes
clear/disallow another owner's context. Known rollback conflict requires reload
and explicit confirmation of a new action/key. No key TTL cleanup or ledger.

## 6. Frontend, creation and customer integration

ADMIN `/admin/inventory`, sidebar `Tồn kho`, increase/decrease quantity,
preview, validation, decrease confirmation, pending/double-submit protection,
authoritative success refresh, conflict reload and same-request lost-response
recovery. Loading/empty/error/Retry/session expiry/Forbidden and keyboard/focus/
390/768/1366 verification required. Existing authorized Product/option read
APIs can supply lifecycle/active-size display without adding InventoryItem fields;
inventory stock/version must remain from one authoritative inventory read.

Product create remains stock0/version0/default active. Show
`Đã tạo sản phẩm. Tồn kho hiện tại: 0.` and explicit `Nhập tồn kho` shortcut;
opening a page never creates an adjustment. Routing/preselection mechanics
remain to be verified against frontend source before coding.

Catalog fetch is no-store. Fresh reads use active Product + stock>0 + valid active
size availability; no automatic activation, size creation, Cart removal or Cold
brew data repair. New checkout reads DB. No price/snapshot/Order/Payment/
Promotion/Loyalty or workflow writes from adjustment.

## 7. Verification, risks and readiness

Executed: Git HEAD/status/diff inspection and diff --check PASS; source/contract
audit; Prisma migrate status PASS (5); targeted database READ ONLY inspection;
PDF baseline hash match. next-env SHA256 remains
`0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`.
No A06 unit/integration/component/
PostgreSQL concurrency/browser E2E/full regression execution yet. NFR01,
Firefox, human QA and screen-reader results are NOT VERIFIED.

Pending: current-task migration approval; full document/PDF reread;
implementation; isolated migrations and A–W database
tests; frontend tests; real Nest/Next/PostgreSQL browser verification; required
regression/Prisma checks; document synchronization and diff/secrets/staging
review. No local implementation commit while these remain pending.

A07 depends on established RBAC/admin infrastructure and its separate assigned
task/Promotion OCC migration. This pre-flight does not establish A07 readiness.
**INVENTORY MANAGEMENT NEEDS FIXES — awaiting approval before implementation.**
