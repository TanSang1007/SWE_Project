# A04 — Admin Product Management

Ngày 2026-10-13 (Asia/Saigon). **ADMIN PRODUCT MANAGEMENT READY (technical user scope).** USER-APPROVED EXT-AS04/D35–D37/D39, không requirement PDF mới. A04-C01/A04-C02 APPROVED USER trước coding. Kết quả implementation tại §7–9; pre-flight bên dưới giữ checkpoint lịch sử. A05–A07/B17 ngoài scope.

## 1. Pre-flight và căn cứ

HEAD `570d609e1d1bd8cb11fdc20f4a8804de50305a76`, commit `feat: implement BrewLite staff order workflow`. Diff ban đầu chỉ `frontend/next-env.d.ts`: `.next/types` → `.next/dev/types`; SHA256 `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`, giữ nguyên/exclude staging. Không reset database, seed, sửa applied migration, push, thêm remote hoặc đổi global Git config. Sandbox không khởi tạo process; đọc/chạy test dùng escalation đã được cho phép, Git dùng command-local safe.directory.

Đã đối chiếu AGENTS/README, PDF8 trang, REQUIREMENTS, API_DESIGN, DATABASE_DESIGN, ARCHITECTURE, DECISIONS, DEVELOPMENT_PLAN, TRACEABILITY_MATRIX, PROJECT_STRUCTURE, DESIGN_REVIEW; A00–A03 và các contract liên quan B04–B16. PDF giữ SHA256 `08EFC9A6CC247123500419F01160C76712EC773AFFC998D2193F2873EF5312CC`. D35–D37/AD01 đã approved; không mở lại lifecycle approval. Findings dưới đây là clarification về response theo phase và dữ liệu development thực tế.

| Điều cần xác định trước coding | Căn cứ đã duyệt |
| --- | --- |
| EXT-AS04 mapping | [A00 §2](A00_ADMIN_STAFF_CONTRACT.md), [matrix §8](TRACEABILITY_MATRIX.md): reuse FR01/02/06, BR09/11; AS-T09/14/15 |
| Product CRUD | A00 §5–8; [API §15](API_DESIGN.md) |
| Paths/methods/DTO | A00 §5–6: GET list/detail, POST create, PATCH update, DELETE expectedVersion |
| Model fields | [schema](../backend/prisma/schema.prisma), [DB §3/10](DATABASE_DESIGN.md): id/name/price/imageUrl/stock/version/timestamps; add Product.isActive only |
| Product lifecycle | A00 §8, [D37/AD01](DECISIONS.md): independent stock, default/backfill true, public hide/detail404, preserve Cart/history |
| Referential delete | A00 §8; ProductSize/ProductTopping/OrderItem/CartItem FK Restrict; explicit child-config cleanup only after no-consumer check, atomic |
| ADMIN permission | A00 §3/13, [A01](A01_RBAC_AUTH_CONTRACT.md), JwtStrategy/UsersService DB role then RolesGuard |
| Concurrency | A00 §7, D36, existing Order/Payment stock CAS: shared Product.version, bump once, no overwrite stock/retry |
| Cart/Checkout | A00 §8, [B08](B08_CART_CONTRACT.md), [B09](B09_PRICING_CONTRACT.md), [B10](B10_ORDER_CONTRACT.md), [B11](B11_PAYMENT_CONTRACT.md) |
| Acceptance | A00 §14 AS-T09/14/15 + current user task §§11–15; isolated migration/DB/HTTP/browser + B04–B16/A01–A03 regression |

Source audit: CatalogController/Service and customer detail currently public stock-based reads; CartService keeps current prices/no snapshot; PricingService validates current options/stock in caller transaction; OrderService.create performs Product.version CAS after pricing; PaymentService retry uses saved Order.total/items without current catalog repricing. RolesGuard denies missing metadata/unknown role and reads verified req.user role; JwtStrategy resolves public User from DB for each request. `/admin/products` remains A01 placeholder.

## 2. User-approved clarifications before coding

### A04-C01 — Response DTO across A04/A05

[A00 §6](A00_ADMIN_STAFF_CONTRACT.md) defines `AdminProduct.sizes=[{size,extraPrice,isActive}]` and `toppings:AdminTopping[]`, with AdminTopping `{id,name,price,isActive,version,createdAt,updatedAt}`. A00 §4/D36/DB §10 allocate Topping.version and both option lifecycle fields to A05; current schema has none. [API §15](API_DESIGN.md) explicitly defers option flags until their phase, but does not give an explicit A04 nested topping response without version. Returning fabricated version/flags, advancing A05 schema, or silently changing DTO would not satisfy the exact-contract gate in current task §1.

**APPROVED USER, 2026-10-13:** Product fields exactly A00, including Product.isActive/version/timestamps; A04 sizes `{size,extraPrice}`; A04 toppings `{id,name,price,createdAt,updatedAt}`. Money canonical integer VND strings. No option flags/Topping.version in A04. Option flags belong A05; any Topping.version implementation must follow separately assigned A05 contract, not inferred from A04.

### A04-C02 — Existing Product without size

Read-only development audit found `Cold brew`, ID `11111112-1112-4112-8112-111111111112`, price `50000`, stock1/version0, **zero ProductSize and ProductTopping**. Other two Products have three sizes/two toppings each. This is existing data, not an A04 fixture. A00 §4/DB §10 explicitly require reporting this finding without automatically deactivating/deleting/backfilling options; A00 §8 also requires active Product to have at least one valid size. All existing Products must become active under AD01. Current CatalogService's stock>0 availability alone would still mark this unconfigured Product available.

**APPROVED USER, 2026-10-13:** preserve record/price/stock/options, backfill isActive=true, show available=false when no valid S/M/L size exists. Availability = isActive AND stock>0 AND existence of valid S/M/L size. Public list still hides inactive, active unconfigured Product remains visible with clear unavailable message. Backend rejects new Order via existing INVALID_ITEM_OPTIONS when size is invalid/missing; inactive PRODUCT_UNAVAILABLE takes precedence, stock errors remain OUT_OF_STOCK. Cart rows retained, new checkout validates PostgreSQL, saved Order/Payment retry/Promotion/Loyalty unchanged. No default size, inventory write, or relaxation of create-required sizes. Configuration can be supplied in separately assigned A05.

## 3. Approved implementation boundary after clarification

- ProductCreate exactly `{name,price,imageUrl,sizes:[{size,extraPrice}],toppingIds}`; name trimmed1..120, canonical integer money string0..999999999999, image relative `/images/` max512/no scheme or traversal, sizes1..3 distinct S/M/L, toppingIds0..10 distinct existing IDs. Atomic Product+sizes+associations; stock0/version0/isActive=true server-owned. No create isActive/stock/description/category/SKU or default size.
- ProductUpdate exactly `{expectedVersion,name?,price?,imageUrl?,isActive?}`; integer version0..2147483647, at least one mutable field, reject null/unknown fields. Metadata/flag CAS and timestamp/version+1 share stock OCC; stock never overwritten. Concurrent edit/stock/Order race409 CONCURRENT_UPDATE, overflow/technical fault503; no automatic retry. Create has no idempotency guarantee; timeout must read list before explicit new create.
- JWT required, ADMIN only; STAFF/CUSTOMER403 before resource lookup, missing/invalid JWT401. DB role authoritative; claim/body/header role does not elevate. Private/no-store/Vary Authorization; strict UUID/empty query/body policy, sanitized common errors.
- Delete `{expectedVersion}`→204 only no business consumers; Cart/Order reference/FK race409 RESOURCE_IN_USE. Explicit ProductSize/ProductTopping cleanup and guarded Product delete in one transaction; rollback all on failure; no cascade/FK changes/Cart removal/history loss. Parent serialization/FK/version defend races.
- Product.isActive=false hides public list and yields detail404 NOT_FOUND. Existing Cart retained with unavailable warning/removal; new add/PATCH qty/create409 PRODUCT_UNAVAILABLE. Reactivate leaves stock unchanged. Checkout validation in existing backend Pricing/Order transaction; committed metadata change invalidates previously read Product.version through CAS. Existing snapshots, Promotion totals, Payment retry/replay and B16 restock/reversal remain intact.
- `/admin/products` will replace shell with real ADMIN list/detail/create/edit/toggle/safe delete, VND/status/stock display, pending double-submit gate, authoritative reload, delete confirmation/conflict guidance, form validation, loading/empty/error/Retry/success/401/403/expiry/session isolation. Responsive390/768/1366 and keyboard/focus/labels. Stock is display only; no redesign.

## 4. Verification performed in this pre-flight

| Command / observation | Actual result |
| --- | --- |
| Git HEAD/status/diff | Expected HEAD, sole initial next-env diff |
| npm.cmd run db:status | PASS,3 migrations, local brewlite_dev/public up to date |
| npm.cmd run test --workspace backend | PASS,11 suites232/232, including RBAC/A02/A03 workflow/error/security |
| npm.cmd run test --workspace frontend | PASS,130/130, including RBAC/A02/A03 states/session/actions |
| npm.cmd run test:database | PASS,14 isolated UUID-schema suites318/318; B04–B16/A01–A03 transaction/concurrency/authorization; no development reset |
| Read-only development audit | Products3, Cart2/items1, Orders14/items17, Payments7, LoyaltyAward7; sizes6/associations4/toppings2; one Product without size; repeat audit confirms all16 public-table fingerprints unchanged |
| Hydration diagnostics | Historical log retains external `bis_skin_checked`/`bis_register`/`__processed_` attributes; new diagnostics (evidence kiểm thử cũ đã dọn): frontend localhost3000 returns ERR_CONNECTION_REFUSED for all4 probes, applicationReached=false. Zero warnings cannot count as application PASS. No A04 code/fix, no user profile changes or server stop |

The PostgreSQL pg concurrent-query deprecation and sanitized intentional fault-test error logs remain; no native crash in the completed318-test run. These results verify existing baseline, **not A04 feature acceptance**. No A04 migration/backfill/CRUD/frontend/integration/E2E tests exist yet. Lint/build/Prisma format/validate/generate and browser E2E have not been run in this pre-flight; full post-implementation regression remains mandatory. Existing A03 historical browser PASS is not presented as a new A04 run. A04 checklist stays unchecked.

## 5. Acceptance criteria applied

AS-T09: exact create/read/update DTO/money/options/role matrix/injection/stock rejection/invalid ID/duplicate transport, persistence/rollback, no-consumer safe delete vs Cart/Order FK/reference races, Product CAS versus metadata/stock and stale concurrent update. AS-T15: migration existing-row true/default/no data drift, active stock0/inactive stock>0/reactivation/no stock write, catalog/detail flags, retained Cart unavailable handling/DELETE/new-checkout denial, unchanged Order/Payment/Loyalty/Promotion snapshots/retry/B16 restore. AS-T14: real Next+Nest+PostgreSQL E2E, ADMIN create/edit/toggle/delete and customer price/Cart/checkout integration, STAFF/CUSTOMER HTTP denial, expired/switch/refresh sessions, loading/error/Retry/form/focus/responsive390/768/1366; isolated fixtures/public fingerprints.

Migration must be tested against pre-migration existing fixture rows in an owned schema before development deploy. Append only `products.is_active BOOLEAN NOT NULL DEFAULT true`, no A05 fields/FK alterations. Compare counts and all pre-existing column/history fingerprints before/after, including products/Cart/Order/Payment/Loyalty. Full backend/frontend lint/build/tests, all PostgreSQL suites, Prisma format/validate/generate/status and browser regressions required before READY/local commit.

## 6. Current result and checkpoint

**A04-C01/A04-C02 APPROVED USER; all technical checks below PASS.** Local checkpoint message `feat: implement BrewLite admin product management`, hash reported after commit; no push/remote/global config. Pre-flight test counts below are historical, final evidence at §7–9. A05–A07 remain PLANNED; no ProductSize.isActive/Topping.isActive/Topping.version, inventory adjustment, Promotion CRUD, B17 or UI redesign in A04.

## 7. Implemented API, lifecycle and integrity

[Controller](../backend/src/catalog/admin-product.controller.ts), [DTO](../backend/src/catalog/admin-product.dto.ts), [service](../backend/src/catalog/admin-product.service.ts) in existing CatalogModule. JWT then DB RolesGuard ADMIN on every method; STAFF/CUSTOMER403 before lookup, guest/invalid/expired401, forged role claims/header/body do not elevate. Strict UUID/empty query/read body, private/no-store/Vary Authorization preserving Origin, no public mutation/debug/role management.

| Method/path | Body | Committed success |
| --- | --- | --- |
| GET /admin/products | Empty |200 `{items:AdminProduct[]}`, ID ASC, active/inactive/unconfigured, no pagination/search |
| GET /admin/products/:id | Empty |200 AdminProduct |
| POST /admin/products | ProductCreate |201 AdminProduct |
| PATCH /admin/products/:id | ProductUpdate |200 AdminProduct |
| DELETE /admin/products/:id | `{expectedVersion}` |204 no body |

ProductCreate exactly `{name,price,imageUrl,sizes:[{size,extraPrice}],toppingIds}`: name trim1..120, canonical money strings0..999999999999, relative /images/ path<=512/no scheme/traversal, sizes1..3 distinct S/M/L, toppings0..10 distinct existing UUIDs. Product+sizes+associations atomic, stock0/version0/isActive=true server-owned. No create flag/stock, default size/category/description/SKU. ProductUpdate exactly `{expectedVersion,name?,price?,imageUrl?,isActive?}`, at least one mutable field; reject null/unknown/stock/version/inline options. AdminProduct exactly `{id,name,price,imageUrl,stock,isActive,version,createdAt,updatedAt,sizes:[{size,extraPrice}],toppings:[{id,name,price,createdAt,updatedAt}]}`. Decimal/toFixed(0) monetary serialization, no A05 fields or internal user/Payment data.

Errors: VALIDATION_ERROR400; PRODUCT_NOT_FOUND/TOPPING_NOT_FOUND404 after authorize; stale/CAS/recognized lock409 CONCURRENT_UPDATE; consumer/FK/required-configuration409 RESOURCE_IN_USE; technical/version overflow503 SERVICE_UNAVAILABLE; auth DB faults retain sanitized500. No raw database errors. Create has no idempotency guarantee: duplicate distinct requests may create distinct IDs; pending gate/list inspection after timeout, no automatic POST retry.

[Migration](../backend/prisma/migrations/20261013090000_product_lifecycle/migration.sql) only adds products.is_active BOOLEAN NOT NULL DEFAULT true, no FK/options/stock/price/history modifications. Isolated pre-migration Product/Cart/Order/Payment/Loyalty fixtures preserve old columns and constraints plus new NOT NULL. Then development deploy:4 migrations up to date,3 Products all active,3 earlier migration records unchanged, all15 business-table counts/fingerprints preserved. Existing Cold brew retains ID/name/price50000/stock1/version0/timestamps/zero sizes/toppings; no reset/seed/repair/applied-migration edit. Preservation evidence (evidence kiểm thử cũ đã dọn).

PATCH parent FOR UPDATE + original expectedVersion CAS, allowed fields only, version+1/updatedAt once; stock never overwritten. Shared Product.version interoperates with existing B10/B11/B16 stock CAS; stock activity can invalidate metadata edits. No automatic transaction retry; overflow503 rollback. DELETE locks parent, validates version/consumers, explicitly deletes ProductTopping/ProductSize then guarded Product atomically; no cascade, individual last-size guard does not block full cleanup. Cart/Order history references/FK race409, no persisted version/body after deletion. Cart add/PATCH parent FOR SHARE after existing owner lock serializes option/flag validation and new FK consumers with lifecycle/delete; Cart never bumps Product.version or stock.

Public availability = active AND stock>0 AND valid S/M/L size exists. Inactive list hidden/detail404 NOT_FOUND; active zero-size visible/unavailable with clear customer detail message, no repair. Cart rows/current authoritative price retained, inactive available=false/warning; new add/PATCH/create rejects PRODUCT_UNAVAILABLE409, invalid size INVALID_ITEM_OPTIONS400. DELETE remains under existing unpaid-lock policy. Pricing validates in B10 transaction, Product CAS rejects metadata/flag drift after read. Known inactive checkout rejection clears only transport context and preserves Cart, with adjustment/removal message. Existing Order/Payment snapshots, retry/replay, Promotion/Loyalty history and B16 restoration unchanged; no engine rewrite.

[UI](../frontend/src/components/admin-products.tsx) replaces A01 shell at /admin/products, [typed client](../frontend/src/lib/api/admin-products.ts) parses phased DTO and safe errors/current session. List/detail GET/create/edit/toggle/inline delete confirmation, name/VND/flag/stock/options; no stock adjustment. Loading/empty/error/Retry/success/validation/delete conflict/401/403/expiry/switch; synchronous gate, success only after server confirmation+authoritative reload. Lost response/conflict needs list inspection and explicit new action; confirmed mutation with failed reload only retries GET.403 clears list/form, late old-account responses discarded. Labels/fieldset/focus/keyboard/390/768/1366 retain BrewLite theme.

## 8. Final verification evidence

| Check | Actual result |
| --- | --- |
| npm.cmd run test --workspace backend |12 suites277/277 PASS:232 baseline +45 A04 HTTP DTO/RBAC |
| npm.cmd run test --workspace frontend |145/145 PASS:130 baseline +14 A04 +1 inactive checkout mapper |
| npm.cmd run test:database |15 isolated UUID suites336/336 PASS:318 baseline +18 A04 |
| npm.cmd run lint |Both workspaces PASS, max-warnings0 |
| npm.cmd run build --workspace backend / frontend |Both actual Nest/Next production builds PASS |
| db:format / db:validate / db:generate / db:status |PASS,4 migrations up to date; A05 fields absent |
| npm.cmd run test:products:browser --workspace frontend |PASS real Edge155.0.4283.45, compiled Next3100/Nest3101/PostgreSQL UUID schema; full customer/A01–A03+A04 |

[HTTP tests](../backend/test/admin-products.spec.ts), [PostgreSQL tests](../backend/test/database/admin-products.spec.ts), [frontend tests](../frontend/test/admin-products.test.mjs), [checkout test](../frontend/test/checkout.test.mjs). Actual DB tests verify default/backfill/old columns/history/constraints, exact phased Decimal DTO, Cold brew no repair, stock0 create, unauthorized/forged roles, retained inactive Cart/removal/new checkout no Order/claim, authoritative price drift/new snapshots/old failed Payment retry, two-edit/metadata-stock/metadata-Order/delete-Cart races, real lock timeout409 and version overflow503. AFTER child create/metadata update and full-delete faults roll back all writes/config; sanitized errors. No skipped test/native crash in completed336 suite; pg concurrent-query deprecation/D33 worker recycling remain.

Browser/network evidence (evidence kiểm thử cũ đã dọn), summary (evidence kiểm thử cũ đã dọn): ADMIN create explicit M+5000/stock0, held response double-submit one POST; customer stock0/zero-size unavailable. Isolated fixture stock setup supplies stock for checkout, no inventory API. Price45k→55k updates Cart/new Order60k; deactivate keeps Cart and rejects new Order, reactivate permits sale. Failed snapshot60k survives price80k/inactive and retries60k, old Order items/Payment/history unchanged. Referenced delete409, no-reference delete204/confirmation cancel no POST, stale409/no auto retry, lost committed response/list inspection, real DB demotion403 clears private form/list, guest401/STAFF-CUSTOMER mutations403, refresh/re-login/account switching. All customer/Promotion/Loyalty/history/operator/preparation/Admin paid-cancel regressions remain enabled. Product form390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md))/768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md))/1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), list390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md))/768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md))/1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)) and A04-prefixed regression images reviewed; no overflow,45px controls, labels/real Tab-Enter focus.

Test factory overrides only Prisma adapter/schema, no production route/auth bypass. Owned UUID schema/3100–3101/source snapshot, A04 prefix preserves historical evidence, own cleanup and all16 public fingerprints unchanged. Development servers/profile unchanged. Actual compiled clean profile runtimeExceptions0/hydrationWarnings0; user's original warning not claimed fixed. Initial diagnostics connection-refused cannot establish hydration; old external attributes only suggest browser injection.

Development Catalog smoke (evidence kiểm thử cũ đã dọn) uses an owned temporary compiled HTTP server, GET-only public reads and trusted internal Admin projection read: all3 development Products parse with the actual frontend parsers, Cold brew price50000/available=false/empty sizes and toppings. No mutation; repeat migration integrity audit preserves all old business-table fingerprints.

## 9. Corrections, review and limits

Before PASS: image traversal/double-slash regex fixed with rejecting tests; migration assertions handled new PostgreSQL NOT NULL and JSON timestamp normalization, Payment assertion follows B11 nested response; old A01/A02 absent-Admin assertions updated to actual401/403. Harness schema allowlist/interception placement/client navigation corrected; full navigation intentionally loses memory JWT. E2E caught generic inactive checkout message, now mapped explicitly and tested as actionable known rollback. No assertion disabled, business/auth workaround, reset or dependency change.

README/API/DB/Architecture/Plan/Matrix/A00/D39 updated. Technical A04 READY does not claim human manual QA, Firefox/full browser matrix, NFR01 latency, team review/Compose/full DoD/B17. Create transport remains non-idempotent and stock0 requires separate A06 topup. A05–A07 PLANNED; no option flags/version, inventory adjustment, Promotion CRUD, role-management UI or redesign. PDF/next-env unchanged, next-env excluded; local checkpoint only after scope/diff/secret review, no push/remote/global Git config.
