# A02 — Operator Order Management

**UI01 / D40 intentional USER-APPROVED contract change, 2026-10-13:** [UI01](UI01_ROLE_BASED_INTERFACE_CONTRACT.md) supersedes historical STAFF all-status list/detail below. STAFF default PAID/PREPARING/READY; exact filter also COMPLETED; forbidden PENDING/PAYMENT_FAILED/CANCELLED403. Hidden detail404 ORDER_NOT_FOUND. ADMIN all seven retained. Backend enforces current DB role/status in query; DTO/sort/no-store/read-only/snapshot/current revision preserved. Role-specific frontend routes/layouts replace shared shop chrome. UI01 tests/regression PASS in the linked contract; historical A02 evidence remains the original all-status STAFF checkpoint.

Ngày 2026-10-12 (Asia/Saigon). **OPERATOR ORDER MANAGEMENT READY (technical user scope)**. USER-APPROVED EXTENSION EXT-AS02, không requirement mới của PDF. Starting HEAD `a124d73934a479e8575109119cdd0ca263e0c63a`; chỉ diff sẵn `frontend/next-env.d.ts`, giữ nguyên/excluded. PDF đủ 8 trang đã đọc, giữ nguyên baseline SHA256 `08EFC9A6CC247123500419F01160C76712EC773AFFC998D2193F2873EF5312CC`.

## Contract trước implementation

| Rule | Căn cứ đã duyệt |
| --- | --- |
| EXT-AS02; mọi owner, STAFF/ADMIN only; CUSTOMER403 trước resource lookup | [A00 §2–3/13](A00_ADMIN_STAFF_CONTRACT.md), D35/D36; [A01](A01_RBAC_AUTH_CONTRACT.md) |
| GET `/operator/orders`, optional một exact OrderStatus; GET `/operator/orders/:id`, UUID/empty query; cả hai empty body | A00 §5; [API §15](API_DESIGN.md) |
| Summary B15 + version/updatedAt; detail B10/B15 + version/updatedAt; không owner PII/raw Payment/award/idempotency | A00 §6; [B10](B10_ORDER_CONTRACT.md), [B11](B11_PAYMENT_CONTRACT.md), [B15](B15_ORDER_HISTORY_CONTRACT.md) |
| createdAt DESC/id DESC; no pagination/search/default limit; empty items valid | A00 §5 |
| Current status/version từ cùng Order read; snapshots không reprice; effective earnedPoints/latest Payment status giữ B15 | A00 §7; B10/B11/B15; [B16](B16_ORDER_WORKFLOW_CONTRACT.md) |
| JWT guard trước DB RolesGuard; role claim không authority; DB change hiệu lực request kế tiếp | A00 §3/13; A01; B07 |
| private/no-store/max-age=0, Vary Authorization giữ Origin; authorized DB faults503 sanitized, auth faults500 | A00 §5; API §1/15 |
| FE `/operator/orders`, `/operator/orders/[id]`, loading/empty/error/Retry/Refresh/401/403; memory auth/reload login; late response discard | A00 §12; A01/B15 |
| Read-only: no Order/status/version/Cart/stock/Payment/Promotion/award/balance/claim/timestamp mutation | A00 §14 AS-T05/14; task A02 |

Không essential contract/open decision thiếu: A00 §16, DECISIONS D35–38 và DESIGN_REVIEW closure. A03–A07 **PLANNED**. Không state mutation endpoint/button, PAID cancellation, Product CRUD, B17 hoặc full redesign.

## Existing Order audit trước A02

| Feature | Classification | Source |
| --- | --- | --- |
| Schema Order/status/version/OCC, immutable items/options/prices/promotion snapshot | ALREADY IMPLEMENTED | Prisma schema; OrderService.create B10 |
| Payment success/failure/retry, current latest status, atomic award/reversal/balance | ALREADY IMPLEMENTED | PaymentService B11; OrderService.transitionOrder B16 |
| Customer GET /orders/me and /orders/:id ownership/read projections | ALREADY IMPLEMENTED | OrderController/OrderService B15 |
| B16 graph/preparation/paid-cancel internal command | ALREADY IMPLEMENTED | OrderService.transitionOrder; no HTTP binding |
| Operator shell /operator/orders | PARTIALLY IMPLEMENTED | A01 auth/nav/permission shell; placeholder |
| Operator list/detail APIs and actual Order UI | NOT IMPLEMENTED | A02 scope |

Reuse OrderService snapshot/detail/earnedPoints và OrderSummary. Không rewrite pricing, Payment, inventory, loyalty hoặc workflow.

## DTO và permission matrix

Summary exact `{id,orderCode,status,total,currency:"VND",createdAt,earnedPoints,version,updatedAt}`. Detail exact `{id,orderCode,status,currency,items,subtotal,discountAmount,total,promotionCode,createdAt,paidAt,earnedPoints,paymentStatus,version,updatedAt}`. Item `{productId,productName,size,qty,unitPrice,lineTotal,toppings:[{name,price}]}`. Money canonical integer strings; version INTEGER0..2147483647; UTC ISO8601 timestamps. No userId/email/hash/token/balance/raw Payment/award/internal keys. `earnedPoints` null before award, original active stored points including0, CANCELLED/reversed contribution0. No formula recalculation.

| Endpoint | Guest/invalid JWT | CUSTOMER | STAFF | ADMIN |
| --- | --- | --- | --- | --- |
| Both operator GETs | 401 | 403 | 200/400/404/503 as appropriate | 200/400/404/503 as appropriate |
| Customer history/detail | 401 | Owner only, cross-owner404 | 403 | 403 |

Status filter exact one of PENDING/PAYMENT_FAILED/PAID/PREPARING/READY/COMPLETED/CANCELLED; omitted includes all. Empty/lowercase/multiple/unknown filters rejected400; list no other query/body fields, detail no query/body fields. Detail missing404 ORDER_NOT_FOUND. Frontend and backend namespaces have distinct origins though paths agree.

## Acceptance và verification plan

AS-T05: list all owners/empty/multiple/all seven statuses/filter/stable ties; detail exact snapshots/pricing drift/promotion/payment/points/version; no sensitive data; 401/403/forged claims/DB roles/customer ownership; DB faults safe; all business fingerprints unchanged. AS-T14: real compiled Next/Nest/PostgreSQL browser login/list/detail/reload/logout/account switch/customer checkout visibility/read-only; loading/empty/error/Retry/session expiration/late response;390/768/1366 no overflow, keyboard/focus/labels. Measure query count for1 versus many Orders; no NFR01 PASS claim.

Use UUID schema for PostgreSQL tests, migrations scoped ORM + raw search_path, cleanup own fixtures only. Full backend/frontend lint/build/default tests, all PostgreSQL regression and Prisma format/validate/generate/status required before READY/commit. Keep historical evidence; no reset development DB or stored credentials.

## Pre-flight diagnostics

Next development16.3.8 + real Edge login/customer/operator/admin shells + isolated PostgreSQL fixtures: **2 Issues NOT REPRODUCED**, no runtime exception/Next error badge. DB guard probes (test-only, not production routes): CUSTOMER operator403/admin403, STAFF operator200/admin403, ADMIN operator200/admin200. Observed favicon404 (existing baseline), Next development DocumentCookie performance audit and known pg concurrent-query deprecation; no demonstrated A01 error. Backend initially absent produced connection-refused menu error before fixture server started; not application authorization failure. Prisma migration status:3 migrations up to date in local brewlite_dev/public; NODE_ENV=development, FE API localhost3001/BE origin localhost3000. No dev DB reset.

## Actual verification/evidence

Implemented: [controller](../backend/src/orders/operator-order.controller.ts), [OrderService](../backend/src/orders/order.service.ts) operatorHistory/operatorGet in existing OrderModule; no new business engine/schema. [API client](../frontend/src/lib/api/operator-orders.ts) whitelists DTO and scopes responses to token/user/role; [view](../frontend/src/components/operator-orders-view.tsx) session-keyed/abort on unmount, fresh GET/filter/Retry, read-only shared OrderSummary. Both frontend approved routes implemented. 403 removes private data,401 clears current session; late old response cannot clear a new account.

| Check | Actual result |
| --- | --- |
| npm.cmd run test --workspace backend | PASS10 suites195/195:159 baseline +36 A02 HTTP/security/read/error cases |
| npm.cmd run test --workspace frontend | PASS116/116:103 baseline +13 A02 parser/UI/session cases |
| npm.cmd run test:database | PASS13 isolated suites296/296:278 baseline +18 A02 PostgreSQL cases |
| npm.cmd run lint / npm.cmd run build | Both workspaces PASS, max-warnings0; compiled operator routes present |
| npm.cmd run db:format / db:validate / db:generate / db:status | PASS,3 migrations up to date, no schema/migration diff |
| Prisma query event measurement |1 Order and27 Orders both3 queries, including authentication; no per-order query loop |
| npm.cmd run test:operator:browser --workspace frontend | PASS real Edge155.0.4283.45 + compiled Next/Nest/PostgreSQL, customer B06–B15/A01 regression +A02 scenarios |

Sanitized regression evidence (evidence kiểm thử cũ đã dọn), pre-flight diagnostics (evidence kiểm thử cũ đã dọn), [HTTP tests](../backend/test/operator-orders.spec.ts), [PostgreSQL tests](../backend/test/database/operator-orders.spec.ts), [frontend tests](../frontend/test/operator-orders.test.mjs). Actual PostgreSQL fixtures use customer create/Payment and trusted existing B16 commands to produce all7 legal statuses, not new A03 HTTP actions. Catalog/size/topping/Promotion edits preserve operator snapshot. All15 business tables/timestamps fingerprint before/after repeated GETs; actual table-rename fault in isolated schema yields503 and leaves rows unchanged after recovery. Query logging measures3 vs3 (1 vs27 Orders), not NFR01 latency. Existing ownership/Payment/inventory/loyalty/concurrency/rollback tests stay enabled.

Preliminary frontend tests lacked test API env, fixed fixture setup; backend lint required typed response casts, fixed tests only. Browser first attempt omitted operator interception; second exposed fallthrough into Catalog error fixture, fixed operator-only handler. Keyboard retry then required CDP Enter character event (`text:"\r"`) to activate native button; full final E2E PASS without application workaround/disabled assertions. Every failed browser attempt verified public16-table fingerprints unchanged after cleanup. Next-created frontend AGENTS/CLAUDE files were task artifacts removed after stopping the owned development server; root AGENTS unchanged. No dependency/lockfile change.

## Browser evidence, read-only review và checkpoint

Browser/network/layout report (evidence kiểm thử cũ đã dọn): real customer checkout Order appears for STAFF/ADMIN; both list/detail read snapshots/current version/status, CUSTOMER endpoints403, guest/invalid401/forged ADMIN403, same old token DB demotion403 and UI clears data. Refresh requires login and returns to same detail; logout→CUSTOMER and held old GET discard previous data. List/detail network faults clear data/Retry works; empty fixture/loading/filter/401 tested, keyboard Tab/visible focus/native Enter Retry. At390/768/1366, no horizontal overflow, select44px/Retry45px. Images list390 (evidence kiểm thử cũ đã dọn), 768 (evidence kiểm thử cũ đã dọn), 1366 (evidence kiểm thử cũ đã dọn), detail390 (evidence kiểm thử cũ đã dọn), 768 (evidence kiểm thử cũ đã dọn), 1366 (evidence kiểm thử cũ đã dọn) reviewed for theme/readability/wrapping. Long unpaginated list follows approved demo contract; no truncated Order data.

All15 business-table fingerprints and customer create/payment/cancel POST counters unchanged during operator reads. Entire16 public tables including migration history match before/after full harness cleanup; unique fixture accounts/history/promotions removed and original catalog/configuration/history retained. A01 guard probes stay on separate verification-only server, production debug routes absent. No PAID cancellation/transition UI or mutation route introduced. Browser controlled faults/empty response are test fixtures only; successful business data come from PostgreSQL, no fake statuses.

Regression covers checkout/payment success+failure/retry/promotion/loyalty/history/B16 graph/atomic cancellation/rollback/OCC/A01 role provisioning/account isolation. Prisma/schema/migrations/lockfile/engines/PDF/root AGENTS unchanged except addition of operator reads to OrderService. README/API_DESIGN/A00/DEVELOPMENT_PLAN/TRACEABILITY updated; DECISIONS unchanged because D35/D36/A00 already authorize this exact implementation. Local checkpoint message `feat: implement BrewLite operator order management`; hash reported from Git after commit, not embedded into its own content. Stage only A02 sources/tests/docs/evidence, preserve exact next-env pre-flight bytes outside commit. No remote/push/global config changes.

## A03 dependency and known limits

A02 exposes current Order version/status, reusable snapshot display and fresh GETs only. A03 must explicitly bind authorized wrappers to existing B16, retain expectedVersion and graph/atomicity/lost-response rules. No A03 endpoint/button implemented here. Memory token reload requires login; logout clears local session but JWT valid to expiry; last-login frontend role hint may be stale, backend DB role remains authority. Dataset demo unpaginated; no realtime/polling/performance SLA inference. Human QA/Firefox/NFR01/team DoD/Compose/B17 remain separate.
