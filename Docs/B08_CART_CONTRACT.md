# B08 — Persistent Cart contract and evidence

User-authorized scope: FR02/03, UI02/UI03/badge; FR08 empty/subtotal portion only. PostgreSQL persistence replaces Q05/D05 client storage. PDF unchanged. No checkout/order/payment/loyalty/staff/admin implementation.

## Behavior

- Cart created lazily on first add, unique user_id; CartItem + CartItemTopping persist in PostgreSQL. Logout never deletes DB cart. Reload requires login again under unchanged B07 JWT memory policy, then fetches saved cart.
- Four protected endpoints only: GET /cart (200), POST /cart/items (201), PATCH /cart/items/:id qty only (200), DELETE /cart/items/:id (200). All return full cart `{items,totalQuantity,subtotal,currency}`. No userId query/body/path; JWT subject controls ownership; absent/cross-owner item 404 CART_ITEM_NOT_FOUND.
- Product UUID + size + sorted lowercased unique topping IDs determine configuration_key; UNIQUE(cart_id,configuration_key). Simple user-row transaction lock serializes concurrent add/merge. No lock/reservation on inventory. Qty 1..99 after merge, configurations <=50, toppings <=10; DTO whitelist/UUID/size/association validation. Available=stock>0; cart qty is not a stock reservation.
- Prices from current database, not Cart snapshots or frontend input. Prisma Decimal base+size+sum toppings; line=unit*qty; subtotal=sum lines. API strings, Q19 maximum999999999999 checked before commit; no floating business calculation. Frontend BigInt VND display/preview follows B06.
- Edit configuration keeps qty. Unchanged options no-op; changed options POST first then DELETE old. Failed POST leaves old intact. Failed DELETE leaves both, warning offers deletion retry only. Ambiguous network failure fetches current cart and asks user to inspect; POST is not idempotent and is never automatically retried.
- Auth/cache isolation: logout/user switch clears cache; stale old-session responses ignored; cart editor remounts with session changes. No localStorage/sessionStorage for Cart. Checkout placeholder disabled.

## Implementation

Backend: `src/cart/{cart.module,cart.controller,cart.service,cart.dto}.ts`, AppModule registration. Prisma adds Cart/CartItem/CartItemTopping; migration `20261007120000_persistent_cart` adds three tables, six FK, three PK, two UNIQUE indexes, quantity CHECK and relation indexes. SQL reviewed before deploy, original init unchanged. Composite FK product_id/size enforces valid size. Topping association/key construction/cart bounds enforced by service. Cascades limited to Cart→item→selected toppings; catalog/user RESTRICT.

Frontend: `/cart`, AddToCart, CartOptions, CartView/CartItems, typed Cart API, memory cache store and nav badge. Detail selects catalog-provided options; quantity ±, edit size/add/remove/change toppings, remove, loading/error/empty/subtotal states.

## Real browser E2E

[Browser evidence](B08_CART_BROWSER_EVIDENCE.json): Edge154.0.4258.62, compiled Next/Nest and PostgreSQL public development schema. Automated real browser interaction, not a claim of human-operated manual QA.

Verified Cappuccino M+Kem: unit55000/qty1; increase qty2 subtotal110000; edit L without topping subtotal110000; add Caramel via edit subtotal124000; duplicate configuration merged qty3/subtotal186000 into one DB row. Reload clears JWT, login restores qty3; logout/login restores cart; remove renders empty and DB item count0. Catalog snapshot (id/price/stock/version/updated_at) identical before/after; test fixture account/cart cleaned. No tokens/passwords in evidence. Menu regression across390/768/1366px, error/loading/empty fixtures, auth register/login/guard/logout regression also PASS.

## Database verification

Metadata (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)): 15 tables, 99 columns, 22 FK, 30 CHECK, 33 indexes, 5 enums. Constraints validated; migration checksums/finished state and seed counts/test schema cleanup PASS. Migration deploy PASS, status up to date. No db push/reset/drop database/init rewrite.

## Checks and limits

Prisma format/validate/generate PASS. Backend and frontend lint/build PASS. Backend foundation16 tests PASS; PostgreSQL88 tests PASS (B04/B05/B07 regression +19 B08 Cart behavior/constraints/bounds/concurrency/precision/no inventory mutation). Frontend33 Node tests PASS (23 regression +10 Cart API/cache/auth/error/edit safety/render/merged totals), interactive flow covered in real Edge E2E. PostgreSQL concurrency suite emits an existing pg query deprecation warning; no failure. Full checks are recorded by terminal execution; early harness failures fixed before final PASS.

This is technical B08 readiness. No Firefox matrix/NFR latency/full-product checkout E2E/team review/full DoD claim. Two-request option editing is not atomic; partial failure retains data with explicit recovery. Prices are current catalog values, not an order snapshot. B09+ still pending.
