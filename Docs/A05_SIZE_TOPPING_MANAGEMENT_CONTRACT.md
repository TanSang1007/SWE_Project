# A05 — Admin Size & Topping management

2026-10-13. USER-APPROVED EXT-AS05; AD02/D37 plus explicit Topping OCC approval [D41](DECISIONS.md), clarifying/superseding earlier prompt restriction only. **SIZE TOPPING MANAGEMENT READY (technical user scope).** Starting HEAD950ad6945faf506ee411fcc538cac1b08b388e3a, only pre-existing next-env diff preserved/excluded. PDF baseline unchanged. Pre-flight/audit A00/A01/A04/UI01/B04–B16 and current source completed before application changes;4 migrations up to date at pre-flight,5 after verified A05 deploy. FR02/03/06, BR10/11 and AS-T10/14/15 reuse, not new PDF requirements.

## Schema, preservation and lifecycle

New append-only migration: ProductSize.isActive Boolean default/backfill true; Topping.isActive Boolean default/backfill true; Topping.version Int default/backfill0, NOT NULL/CHECK>=0. No ProductTopping flag/ProductSize.version, stock/base price/history/owner modifications. Existing IDs/old columns/FK/constraints retained. Test legacy Cart/Order/Payment/Loyalty fixtures and old-column fingerprints before development deploy; no reset/seed rewrite/applied-migration edit.

Size remains product-specific PK(productId,size), TEXT with existing SQL S/M/L CHECK; no global/custom Size. Public options only active; product available iff Product active, stock>0, active valid size exists. Cold Brew retains price50000/stock1/zero sizes/unavailable until an explicit authorized add; no auto size. Active Product cannot retire its last active size409 RESOURCE_IN_USE (retire Product first). Individual last configured size delete blocked regardless of Product flag; full no-consumer Product delete retains A04 explicit atomic cleanup exemption. Global topping retirement has no last-topping constraint; no topping is valid.

## Approved API mapping

All below JWT→current DB ADMIN; STAFF/CUSTOMER403 before lookup, guest/expired/invalid401. UUID lower-case/strict DTO/empty query/body for GET, no unknown/null/coerced fields. Money canonical integer Decimal/VND strings0..999999999999; names trim1..120. private/no-store/Vary Authorization preserving Origin. Sorting sizes S/M/L, Topping IDs ASC; no pagination/search. Existing A04 AdminProduct phased DTO retained; dedicated A05 projections expose lifecycle/OCC.

| Method/path | Body | Success |
| --- | --- | --- |
| GET /admin/products/:id/sizes | none |200 `{items:AdminSize[],productVersion}` |
| POST /admin/products/:id/sizes | `{size,extraPrice,expectedVersion}` |201 `{item:AdminSize,productVersion}` |
| PATCH /admin/products/:id/sizes/:size | `{expectedVersion,extraPrice?,isActive?}` |200 `{item:AdminSize,productVersion}` |
| DELETE /admin/products/:id/sizes/:size | `{expectedVersion}` |204 |
| GET /admin/toppings; GET /admin/toppings/:id | none |200 `{items:AdminTopping[]}` / AdminTopping |
| POST /admin/toppings | `{name,price}` |201 AdminTopping(active=true,version0) |
| PATCH /admin/toppings/:id | `{expectedVersion,name?,price?,isActive?}` |200 AdminTopping(new version) |
| DELETE /admin/toppings/:id | `{expectedVersion}` |204 |
| GET /admin/products/:id/toppings | none |200 `{items:AdminTopping[],productVersion}` |
| POST /admin/products/:id/toppings | `{toppingId,expectedVersion}` |201 same association list |
| DELETE /admin/products/:id/toppings/:toppingId | `{expectedVersion}` |204 |

AdminSize exact `{productId,size,extraPrice,isActive}`; AdminTopping exact `{id,name,price,isActive,version,createdAt,updatedAt}`. No client IDs/lifecycle/version on create, no credentials/internal keys. PATCH needs a mutable field.400 VALIDATION_ERROR/INVALID_ITEM_OPTIONS,401 UNAUTHORIZED,403 FORBIDDEN,404 PRODUCT_NOT_FOUND/SIZE_NOT_FOUND/TOPPING_NOT_FOUND,409 CONCURRENT_UPDATE/RESOURCE_IN_USE/RESOURCE_ALREADY_EXISTS,503 SERVICE_UNAVAILABLE; shared sanitized envelope/auth DB fault500 retained.

## Referential safety and concurrency

Size/association: lock parent Product FOR UPDATE, validate existence/original version, guards, mutate config and parent CAS version+1/updatedAt once in short existing transaction bounds; no stock update. Cart already locks owner then Product FOR SHARE; selected Toppings locked FOR SHARE in sorted order and reread for lifecycle. Association remove blocked if persistent Cart or Order snapshot uses product+topping, despite no FK to association. Size delete blocked by Cart composite FK, OrderItem product+size service guard or last-size rule. No cascade/history cleanup. FK races sanitized409. Duplicate config409.

Topping: lock global row FOR UPDATE, reread, missing404/stale409, update CAS version/allowed fields/version+1/timestamp once. DELETE guards ProductTopping/CartItemTopping/OrderItemTopping and original version in same transaction, no cascade. Price/name/flag do not bump all parent Product versions. Overflow503 rollback, recognized lock/transaction races409, no automatic retry. B09 snapshots configuration valid at DB read; no commit-time global repricing promise. Product option changes bump shared Product.version so B10 stock CAS detects drift. Tests must prove concurrent PATCH/PATCH, PATCH/DELETE, parent update/Cart selection/Order create and fault rollback.

## Customer compatibility and invariants

Catalog retains public DTO/money shapes, filters inactive size/topping; no public version. Cart retains stored selections and ownership, current Decimal prices and available=false for invalid options with meaningful warning; no implicit cleanup/substitution. New add/PATCH/create validate current membership/flags, INVALID_ITEM_OPTIONS400. Removal/correction use B08 existing allowed flows/unpaid lock; checkout never replaces options. Saved PENDING/failed Order/Payment retry still uses stored snapshot and stock OCC, no lifecycle revalidation/reprice. Promotion/Payment/paidAt/award/reversal/B16 unchanged; COMPLETED no extra award, paid-cancel exact stock/Loyalty/no refund.

## Frontend modules/routes

Reuse UI01 ADMIN shell and existing Product CRUD. Discoverable product-row/form link `/admin/products/[id]/options`: all sizes/edit/add/toggle/delete and topping membership, current parent revision/availability. Global `/admin/toppings`: list/detail/create/edit/toggle/safe-delete. No STAFF/customer controls or change to UI01 queue/read scope/shared login/memory session. A04 phased projections cannot prove option activity; list points to authoritative options screen for readiness instead of guessing availability from size count. Forms inline/native confirmations with labels/focus/44px controls/390/768/1366/no overflow; pending synchronous gate,409/lost response requires fresh GET/user review/new action, no mutation replay. Session-keyed state/abort/late-response discard/401 current-session clear/403 private-data removal.

## Acceptance and verification

A05-T01 migration/default/CHECK/FK/old fingerprints before deploy; T02 all twelve routes/DTO/money/auth/forged claims/sanitized errors/read-only; T03 lifecycle/membership/last-size/delete references; T04 current pricing/persistent Cart/invalid checkout/stale client; T05 saved Order/Payment retry/Promotion/stock/Loyalty/B16 invariants; T06 actual concurrent writes/selection/create/rollback; T07 UI01 options/global topping/pending/409/reload/session/keyboard/responsive; T08 real Next/Nest/PostgreSQL E2E plus full B04–B16/A01–A04/UI01; T09 docs/diff/secrets/protected hashes/explicit local commit.

## Actual implementation and preservation

[Controllers](../backend/src/catalog/admin-option.controller.ts), [strict DTOs](../backend/src/catalog/admin-option.dto.ts), [service](../backend/src/catalog/admin-option.service.ts) in existing CatalogModule; [migration](../backend/prisma/migrations/20261013160000_option_lifecycle/migration.sql). Customer changes limited to Catalog/Cart/Pricing active validation/read projections; Order/Payment/B16 service bodies unchanged. [Client](../frontend/src/lib/api/admin-options.ts), [UI](../frontend/src/components/admin-options.tsx), discoverable A04 Product row/form links and UI01 Admin navigation. Existing A04 DTO remains unchanged; no inventory form/stock assignment in option service.

Development migration evidence (evidence kiểm thử cũ đã dọn): isolated old-data migration tests and full365 PostgreSQL tests completed before development deploy. Only three columns and CHECK added; all15 business-table old-column counts/fingerprints/timestamps, FK definitions and four previous migration records unchanged.5 migrations up to date; all existing sizes/toppings active, Topping versions0. No reset/seed/default-size insertion/Cold Brew price-stock-options change. Test Stock values are initial isolated fixtures or existing B04–B16 regression setup, not new management capability or development changes.

## Actual verification

| Check | Result |
| --- | --- |
| Backend lint/build/default tests | PASS13 suites328/328, max-warnings0 |
| Frontend lint/actual Next production build/component tests | PASS163/163; build byte-identical source snapshot preserves next-env/development .next |
| PostgreSQL full B04–B16/A01–A05/UI01 | PASS16 UUID suites365/365, no skipped cases |
| Prisma format/validate/generate/status | All PASS;5 migrations up to date |
| Real browser full customer/A01–A04/UI01+A05 | PASS Edge155.0.4283.45, Next3100/Nest3101/owned UUID schema;30 check groups |
| Responsive/accessibility | PASS390/768/1366 no overflow,45px actions, native Tab/Enter/focus/labels/inline confirmation |
| Compiled browser hydration/runtime |0 warnings/0 exceptions; original-profile issue not claimed FIXED |

[HTTP tests](../backend/test/admin-options.spec.ts), [PostgreSQL tests](../backend/test/database/admin-options.spec.ts), [frontend tests](../frontend/test/admin-options.test.mjs), full regression summary (evidence kiểm thử cũ đã dọn), browser/network/cleanup evidence (evidence kiểm thử cũ đã dọn). Exact flags/default0/CHECK/preservation, parent/Top OCC, stale/missing/reference/duplicate/strict DTO/auth/DB role/forged claims/errors/GET fingerprints tested. Actual simultaneous Topping PATCH/PATCH and PATCH/DELETE, size versus association parent CAS, association detach versus Cart selection, deterministic B09 barrier for parent option edit/Order conflict and global Topping read-time pricing snapshot. AFTER UPDATE faults at Top/size and parent-after-association rollback every business field/version/timestamp. Failed Payment retry retains original55000 snapshot after retired options/new prices; paid cancellation exact stock/award/Payment preserved; COMPLETED no reaward. Existing stock/OCC/Promotion/Loyalty/customer-ownership/UI01 restriction regressions remain enabled.

## Browser evidence and corrections

Actual A05 scenarios: Admin opens Product→edits M extra7000/adds L10000→creates global Top5000→associates it. Customer sees/adds62000 configuration. Retiring size or Top preserves Cart and rejects new Order400; edit retains retired selection and requires explicit correction. Reactivation allows real PENDING→PAID62000; later price edits produce future preview70000 and leave original Order/items/Payment/award unchanged. Independent edit invalidates open Top form,409 shows reload/review with no overwrite/retry; referenced delete409, unused delete204. Held real POST response proves pending/double-submit one record/no optimistic success. Staff/Customer403, guest401/logout/private state isolation, UI01 navigation/queue/read scope stay correct. Isolated Cold Brew fixture stock1/base50000/zero sizes becomes available only after explicit size; development record untouched.

Screenshots reviewed: options390 (evidence kiểm thử cũ đã dọn), options1366 (evidence kiểm thử cũ đã dọn), Toppings390 (evidence kiểm thử cũ đã dọn), Toppings1366 (evidence kiểm thử cũ đã dọn); other768/form/customer/workflow screenshots are A05-prefixed. Successful business data comes from real APIs/PostgreSQL; controlled legacy network-error fixtures only test loading/error/recovery, no fake business success. Each failed/final browser attempt drops its owned schema and verifies all development public-table fingerprints unchanged; own fixture IDs cleaned, no development server stopped.

Before PASS: fixed actual CartItemTopping relation guard by querying parent consumers; removed unused lint suppression and typed matcher assignment; adapted historical A04 migration assertions to snapshot its own migration before later A05 apply; A01 absence assertion updated to approved current lifecycle while preserving role/FK/fingerprint checks. Browser harness captured held response ID before reset, awaited actual Orders mount, used reload/data rather than Add Size readiness when S/M/L already present, and used stable payment selector that includes amount in label. No assertions disabled/business workaround/engine rewrite. One initial backend unit process terminated natively3221226505; unchanged original test command rerun passed328, root cause unproven (D33 limit), not claimed fixed.

## Remaining issues, A06 and checkpoint

Human manual QA/screen-reader testing, Firefox/full browser matrix, NFR01 latency, team review/full DoD/Compose pending; not inferred from automated PASS. Known pg concurrent-query deprecation/D33 upstream native cause unproven. Demo unpaginated lists remain contract; no scalability claim. Memory JWT refresh requires re-login; DB authority next request despite last-login UI hint. Per-product Top retirement flag remains outside approved association policy; global lifecycle plus guarded detach only.

A06 prerequisites A01/A04/A05/shared Product.version are available; A06 still requires its own task, enum ADJUST_INVENTORY/operation-aware claim CHECK/idempotent delta/OCC tests. **A06/A07/B17 remain PLANNED, not implemented.** Requested local checkpoint `feat: implement BrewLite admin size topping management`; hash reported from Git after commit, not embedded in its own content. Stage only A05 sources/migration/tests/docs/evidence, exclude exact next-env bytes/build/generated/unrelated files. No push/remote/global config change.
