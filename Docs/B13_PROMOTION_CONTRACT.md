# B13 — Promotion implementation and acceptance

Confirmed FIXED AMOUNT baseline Q10/D07/D18/D26; B09–B12 reused. PDF unchanged. Q01–Q19/DR01–DR15 closed/scoped; assigned B13 matches the backlog. Technical acceptance does not imply full product/team DoD.

## Development seed follow-up — 2026-10-09

The original B13 verification ran the seed in isolated test schemas; its browser Promotion was a temporary fixture removed afterward. It did not insert BREW10K into public development data. The original result described implemented seed source, not a completed development seed run. Direct `SELECT * FROM public.promotions ORDER BY id ASC` confirmed0 rows on localhost5432/brewlite_dev/public before this follow-up; there was no connection mismatch.

Backend ConfigModule, Prisma config and seed resolve the same root `.env` DATABASE_URL; effective URL matched that file without an inherited override, confirmed by current_database()/current_schema()/server endpoint. Credentials were not printed or changed. Added `--promotion-only` to `backend/prisma/seed.cjs`, sharing the existing INSERT ON CONFLICT DO NOTHING helper. The default full seed retains its catalog behavior. Actual command from repository root, run twice: `node backend/prisma/seed.cjs --promotion-only`.

Direct SELECT afterward: one row, UUID44444444-4444-4444-8444-444444444441, codeBREW10K, discount_amount10000, minimum_subtotal0, starts_at2026-01-01T00:00:00Z, ends_at2028-01-01T00:00:00Z, is_active=true. created_at/updated_at2026-10-09T09:47:06.816Z; both unchanged by second run. DB CURRENT_TIMESTAMP eligibility true. The code can be used when creating a new checkout Order; existing Orders retain their snapshots.

Exact row fingerprints and counts of every other public base table matched before/after: products3, sizes6, toppings2/associations4, users1, carts1/items2/selected toppings3, orders8/items10/selected toppings13, payments4, awards4, claims12 and migration records2. No reset/drop/delete or catalog/business mutation. Added a PostgreSQL test for promotion-only CLI/repeat/no other rows written: dedicated suite28/28 PASS and backend lint PASS; full seed regression is included in that suite. D33 isolation unchanged. The earlier197-test/full browser evidence below remains historical; a new full regression was not claimed for this seed-only follow-up. No commit/push/B14 work.

## Baseline and acceptance mapping

| Source | Exact requirement / application |
| --- | --- |
| FR15, PDF §9 ý4 | “Áp mã giảm giá hợp lệ vào đơn” |
| BR08 | “Chỉ mã khuyến mãi hợp lệ được áp dụng; PAID mới được cộng điểm” |
| BR09 | “Giá/tổng/giảm giá/điểm được backend tính từ dữ liệu tin cậy, không nhận số tiền client làm nguồn đúng” |
| BR11/BR12/BR14 | Immutable historical snapshot; one successful Payment/award; integer VND, one code/Order |
| API_DESIGN §5/§8/§10 | Optional promotionCode in POST /orders; show server total before payment; invalid promotion creates no Order; replay survives promotion changes |
| DATABASE_DESIGN promotions | Existing/active code, startsAt <= now < endsAt, subtotal >= minimumSubtotal; configured discount CHECK>0 |
| DEVELOPMENT_PLAN B13 | FIXED AMOUNT policy, seed, validation/snapshot/input, boundary tests; Task10/FR15; B10/B12/Q10 dependencies |

Adjacent regression: FR03/05–09/12–14/16, BR02/04/06–07/10/13, NFR02/04–06/10. Sources: [API](API_DESIGN.md), [database](DATABASE_DESIGN.md), [pricing](B09_PRICING_CONTRACT.md), [Order](B10_ORDER_CONTRACT.md), [Payment](B11_PAYMENT_CONTRACT.md), [checkout](B12_CHECKOUT_ACCEPTANCE.md).

## Existing features audit

| Feature before B13 | Classification | Evidence / action |
| --- | --- | --- |
| Promotion schema/config/Decimal/CHECK/FK | ALREADY IMPLEMENTED | B04; unchanged schema/migrations |
| Optional code trim/uppercase1..32, DB resolution/internal ID | ALREADY IMPLEMENTED | B10 DTO/OrderService reused |
| Pricing FIXED AMOUNT/cap/max0 and DB eligibility | ALREADY IMPLEMENTED | B09 PricingService reused |
| Monetary validation/error consistency | PARTIALLY IMPLEMENTED | Generic helper returned400 for malformed config, accepted0 in memory despite CHECK>0; B13 aligns with positive DB discount and422 PROMOTION_INVALID |
| Order promotion ID/code/actual discount/subtotal/total snapshots | ALREADY IMPLEMENTED | B10 reused |
| Payment/failed retry from Order.total; PAID floor(total/10000) | ALREADY IMPLEMENTED | B11 reused without lifecycle change |
| Input/error/loading/confirmed discount/total/recovery | ALREADY IMPLEMENTED | B10/B12; B13 adds server-confirmation explanation |
| Runnable demo Promotion seed | NOT IMPLEMENTED | Adds BREW10K to existing development seed |
| Complete Promotion acceptance/real browser A/B/C | PARTIALLY IMPLEMENTED | Earlier partial tests retained; dedicated suites/evidence added |

## Business rules and validation

All amounts/calculations use Prisma Decimal; storage DECIMAL(12,0); JSON integer money strings. Money finite/integer and <=999999999999. Configured discount comes only from promotions.discount_amount and must be >0 according to existing SQL CHECK; minimumSubtotal >=0. No-code discount=0 is valid. Configured0 is rejected rather than changing the baseline constraint. Negative/fractional/overflow/nonfinite mocked config returns422 PROMOTION_INVALID; PostgreSQL rejects zero/negative configured discounts.

Eligibility at creation: code exists, active, startsAt <= now < endsAt, subtotal >= minimumSubtotal. No user/product eligibility lists, quotas, percentage, stacking, redemption or automatic campaigns are designed or added. One code/Order; omission does not require any Promotion lookup.

```text
discountAmount = min(subtotal, configuredDiscount)
finalAmount = max(0, subtotal - configuredDiscount)
```

Order.discountAmount is the actual capped discount; Order.total/Payment.amount are finalAmount, never negative. Example104002/10000 → discount10000/total94002/points9; configured200000 → discount104002/total0/points0. Zero total follows the same mock Payment lifecycle and awards0 once upon PAID.

## APIs and permissions actually implemented

| Method/path | Permission | Behavior |
| --- | --- | --- |
| POST /orders | JWT customer + mandatory Idempotency-Key | Existing items + optional promotionCode; DB resolve and B09 validation inside existing transaction;201 PENDING snapshot |
| GET /orders/:id | JWT owner, otherwise404 ORDER_NOT_FOUND | Historical code/discount/subtotal/total; current status/paidAt/earnedPoints/paymentStatus |
| POST /payments | JWT owner + mandatory Idempotency-Key | Existing {orderId,method:WALLET or CARD}; snapshot amount/award |
| POST /orders/:id/cancel | JWT owner, unpaid only | Existing cancellation, unchanged lifecycle |

No Promotion list/preview/CRUD endpoint/admin/staff role or new fields/paths. Code syntax/null/empty/over32 →400 VALIDATION_ERROR. Missing/inactive/future/expired/below-minimum →422 PROMOTION_INVALID using sanitized envelope. Injected promotionId/discountAmount/configuredDiscount/total →400 strict DTO whitelist. Technical DB faults sanitized503; no raw SQL/Prisma errors.

## Pricing, Order, Payment and Loyalty

OrderService resolves public code to DB ID, PricingService validates using the caller transaction; no client discount accepted. B10 full Cart equality/owner lock/active-unpaid guard, completed replay before live promotion checks, aggregate stock OCC and atomic claim/Order writes remain. Invalid Promotion preserves Cart, stock/version, Order/items, claim, Payment, award and balance. Order stores original promotionId/code, actual capped discount/subtotal/total; Payment needs no configured-discount snapshot.

Changing code/discount/active/validity/minimum after creation does not affect GET/create replay. Payment never resolves or reprices Promotion; failed retry reacquires snapshot stock only, pays Order.total and awards floor(Order.total/10000). Failed/cancelled unpaid Orders earn nothing; successful zero-total Order gets one award0; replay/concurrency cannot duplicate effects. B11 lifecycle/transaction and D33 worker mitigation retained.

## Demo seed and frontend

`npm.cmd run db:seed` requires NODE_ENV=development. Adds missing UUID44444444-4444-4444-8444-444444444441/codeBREW10K, discount10000, minimum0, active, UTC 2026-01-01,2028-01-01). These are demo configuration, not business constants. INSERT ON CONFLICT DO NOTHING preserves existing code/ID config, disabled/expired state and timestamps; catalog preserves consumed stock/version. No startup/checkout auto-seed or credential/history seed. Tests seed twice in isolated PostgreSQL schemas; browser creates/removes its own Promotion.

Existing /cart optional labeled max32 input retained; helper explains checking on “Đặt hàng”. No confirmed discount before Order response/current GET. Processing disables input/actions and announces busy/loading. Invalid code retains input/Cart with a safe Vietnamese correction message. Summary and Payment button use server snapshot totals. Reload/login uses original context or owned unpaid discovery, never frontend authoritative pricing. No redesign/new route/preview.

## Tests and browser scenarios

Dedicated backend unit tests: positive monetary config/error422, invalid money bounds, inclusive start/minimum and exclusive end. Dedicated PostgreSQL27 tests: no-code0, fixed<equal>subtotal, exact one-dong/max Decimal, policy rejection/full rollback, strict client input, actual DB CHECK0/negative, changed config/replay/retry/Loyalty, same/new-key concurrent checkout, fault after stock write, repeatable seed preserving edits. Existing B04–B12 suites retained. Frontend6 tests: render/loading explanation, POST code-only,422 mapping, exact/zero snapshot and code/key recovery without money authority.

Real Edge `--promotions` retains B06–B12 regression with separate B13 reports/screenshots:

- A: add product, normalized code/minimum equality, hold real Order response to verify loading/no premature discount; snapshot62000-10000=52000; WALLET52000/award5 once/Cart clear.
- B: invalid code422, input/qty1 Cart retained; no Order/stock/Payment/award mutation.
- C: valid promoted Order, failed Payment/no award; change DB code/amount/minimum/active/expiry; reload/login/unpaid discovery; retry historical52000/award5 once.

## Verification and remaining issues

**PROMOTION READY (technical user scope), 2026-10-09.**

| Check at repository root | Observed result |
| --- | --- |
| npm.cmd run lint | Both workspaces PASS, max-warnings0 |
| npm.cmd run build --workspace backend / frontend | Both PASS, backend includes Prisma generate |
| npm.cmd run test --workspace backend | 4 suites59/59 PASS (7 added assertions +52 regression) |
| npm.cmd run test --workspace frontend | 74/74 PASS (6 B13 +68 regression) |
| npm.cmd run test:database --workspace backend -- --json --outputFile=../.b13-database-tests.json | 8 suites197/197 PASS (27 B13 +170 regression); D33 recycled sequential workers |
| npm.cmd run db:format / db:validate / db:generate / db:status | PASS, schema unchanged, two migrations up to date |
| npm.cmd run test:promotions:browser --workspace frontend | Edge154.0.4258.62 real Next/Nest/PostgreSQL A/B/C +B06–B12 regression PASS |

[PostgreSQL/regression report (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), browser report (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)). Owned compiled frontend3000/backend3001/Edge processes stopped; fixture user/Cart/Order/Payment/award/claims/Promotion removed, existing catalog prices/stock/version/timestamps restored and pre-existing Promotion rows identical. Final fixture balance40 represents previous B12 scenarios30 plus two promoted successes5+5;5 successes/5 awards before cleanup. No native exit in this regression run; known pg warning/intentional fault logs only.

Screenshots: promoted PENDING390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), PENDING768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), PENDING1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), promoted PAID390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), PAID768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), PAID1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)). B12 loading/failure/recovery/keyboard/reduced-motion/three-viewport scenarios rerun with B13-only artifacts, previous reports/screenshots untouched.

No schema migration/dependency/version change. Windows native-crash root cause remains unproven; D33 sequential isolated workers retained, concurrent requests still exercised inside suites. Existing pg warning/intentional sanitized fault logs are non-failing. Human manual QA/Firefox/full browser matrix, NFR01 latency, team review/full DoD, B14/B15/B16 and deployment remain separate tasks. No production-readiness claim.
