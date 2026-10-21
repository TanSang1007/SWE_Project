# B09 — Pricing & Order Validation Engine

**L00 frozen design addendum — NOT IMPLEMENTED, 2026-10-14:** D43/A01/B approves future read-only POST /orders/preview and whole-Order Loyalty after Promotion; no Product.price change or write in preview; older no-quote scope is pre-L01.
[Final contract](L00_LOYALTY_REDEMPTION_CONTRACT.md) supersedes only those future extension clauses; existing evidence below is historical baseline. No L01 implementation in L00.

User scope 2026-10-07: internal reusable engine only. No public quote/preview endpoint, promotionCode feature, frontend flow, schema/migration/seed change. API_DESIGN §8 remains unchanged. Sources: REQUIREMENTS FR02/05/06/08/14/15, BR02/07/09/10/14; DECISIONS Q04/Q08/Q10/Q19 and D30; persistent Cart B08.

## Internal contract

`PricingService.validateCart(db, userId, promotionId?, now?)` in exported PricingModule, registered in AppModule with no controller. `db` is the caller's Prisma transaction reader; service never starts a transaction, acquires a write lock, or writes. B10 supplies JWT-derived identity, never client userId, and calls inside its Order creation transaction after idempotency replay handling. Identity must exist; Cart query uses userId and checks owner. Missing/empty Cart rejected, not created.

Cart must have 1..50 unique canonical configurations, integer qty1..99, <=10 unique toppings, correct Cart identity/configuration key and current product size/topping associations. Product must exist and stock>0. Stock requirements aggregate qty across all configurations of each product, sorted by productId; aggregate demand must not exceed stock. Missing product404 PRODUCT_NOT_FOUND; invalid options400 INVALID_ITEM_OPTIONS; empty/malformed/bounds400 VALIDATION_ERROR; unavailable/insufficient stock409 OUT_OF_STOCK; missing identity401. These are internal exceptions through existing Nest primitives, not new HTTP routes/contracts.

Current DB base price + size extra + topping sum = unitPrice; lineTotal=unitPrice*qty; subtotal=sum lines. Every component/derived amount must be finite, integer, nonnegative and <=999999999999 VND. Prisma Decimal throughout, no Float/rounding. Cart stores no monetary snapshot; changes in base/size/topping price appear on next call without Cart writes.

No default global discount or arbitrary client amount. Optional promotionId is an internal trusted DB identifier for an already selected promotion; absence gives zero. Source is existing promotions.discount_amount; eligibility uses active, startsAt<=now<endsAt, minimumSubtotal from DB. No code lookup/normalization/input UI/seed feature in B09. Invalid eligibility422 PROMOTION_INVALID. configuredDiscount validated as integer money>=0; real DB promotion CHECK>0 remains unchanged. discountAmount=min(subtotal,configuredDiscount); finalAmount=max(0,subtotal-configuredDiscount).

Result contains cartId; validated items (cartItemId, productId/name, size/qty, basePrice, sizeExtraPrice, selected topping id/name/price, unitPrice, lineTotal); stockRequirements (productId, aggregate qty, stock, version); subtotal/configuredDiscount/discountAmount/finalAmount; currency VND. Money remains Decimal internally for B10 snapshot writes; public serialization belongs to B10 and must use baseline `total` money string. No password/hash/token or raw Prisma row in result.

## Transaction boundary and no-mutation guarantee

B09 only reads users, Cart, catalog and optional promotion. No Order/OrderItem/Payment/award/status writes; no inventory decrement/reservation and no Cart clear/update. It is validation, not an availability reservation. B10 must re-read prices and call validation again inside creation transaction, re-check aggregate stock/version with atomic OCC update, create snapshots and commit/rollback all business writes together. Passing an earlier result to B10 without re-validation is not supported. State graph foundation previously mapped to B09 now belongs to B10, full workflow B16; no requirement removed.

## Verification

Unit tests exercise missing product/malformed data not representable under PostgreSQL FK/CHECK constraints, price drift, Decimal bounds, stock aggregation, ownership, discount and eligibility. PostgreSQL tests apply existing migrations to a UUID test schema and invoke the actual engine with a Prisma transaction client. They compare Cart/items/selected toppings, products stock/version/timestamps, user points/timestamps and Order/OrderItem/Payment/LoyaltyAward counts before/after success and failure. Fixture changes only affect that test schema, dropped afterward; development seed untouched.

Checks PASS: backend lint/build, 4 suites/51 default tests (35 B09 +16 regression); PostgreSQL 5 suites/96 tests (8 B09 +88 B04–B08 regression); frontend lint/build/33 tests; Prisma validate/generate/migrate status (2 migrations up to date). Existing pg concurrent-query deprecation warning remains non-failing. Existing foundation error-boundary tests intentionally emit two sanitized server-error log messages. No checkout browser/manual E2E claimed because no endpoint/UI exists. Full NFR/browser matrix/team review remain later work.

`frontend/next-env.d.ts` pre-existing diff switched `.next/types` to `.next/dev/types` after Next dev; generated legitimate diff. Production build regenerated production type paths and cleared that diff; no manual restore and no inclusion in B09 commit.
