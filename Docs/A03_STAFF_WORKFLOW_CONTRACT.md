# A03 — Staff Order Workflow & Admin PAID Cancellation

**UI01 / D40 addendum:** [UI01](UI01_ROLE_BASED_INTERFACE_CONTRACT.md) narrows STAFF GET scope and separates queue/completed/Admin screens. A03 POST DTO/permissions/B16 engine/OCC/atomic reversal/no refund unchanged. STAFF completion returns to fresh active queue; completed history is read-only. ADMIN cancellation makes STAFF detail404 on reload/reconciliation and clears snapshot/actions, queue removes cancelled record. UI01 verification PASS including completion/removal/cancellation race/409 and preserved stock-Loyalty-Payment invariants; original evidence below remains historical.

Ngày 2026-10-12 (Asia/Saigon). **STAFF WORKFLOW READY (technical user scope)**, USER-APPROVED EXT-AS03. Starting HEAD `574476ea2f60118fe98b4d712be9fc3e62147ba9`; only existing diff frontend/next-env.d.ts preserved/excluded. PDF8 pages read, unchanged SHA256 `08efc9a6cc247123500419f01160c76712ec773affc998d2193f2873ef5312cc`; extension does not add/remove PDF requirements.3 migrations up to date; no new migration/schema/index/dependency. Historical Next2 Issues A02 NOT REPRODUCED does not mean fixed; current diagnostics below.

## Approved contract before code

| Item | Contract / source |
| --- | --- |
| Scope/IDs | EXT-AS03, reuse FR11/12/14/16, BR05/12/13; [A00 §1–3](A00_ADMIN_STAFF_CONTRACT.md), [REQUIREMENTS §4/6](REQUIREMENTS.md), D35/D36 |
| Permissions | JWT→DB RolesGuard; CUSTOMER403, STAFF/ADMIN preparation, ADMIN-only paid cancel,403 before lookup; A00 §3/13, [A01](A01_RBAC_AUTH_CONTRACT.md) |
| APIs | POST /operator/orders/:id/transitions `{expectedVersion,targetStatus:PREPARING\|READY\|COMPLETED}`; POST /admin/orders/:id/paid-cancel `{expectedVersion}`; A00 §5–6, [API §15](API_DESIGN.md) |
| DTO/status | UUID lower-case, empty query, strict body/no unknown fields, expectedVersion integer0..2147483647;200 existing B16 detail **without version/updatedAt**, then GET A02 coherent current revision; A00 §5–7, [A02](A02_OPERATOR_ORDER_MANAGEMENT_CONTRACT.md) |
| Graph | PAID→PREPARING→READY→COMPLETED only; no new statuses/skipped/self/terminal edges; [B16](B16_ORDER_WORKFLOW_CONTRACT.md), PDF §9/9.1 |
| OCC | Original expectedVersion, Order owner lock, status/version CAS and Product OCC in one B16 transaction; maxWait50/deadline400/lock200/statement300ms; no wrapper transaction/business writes/automatic retry; A00 §7, B16 |
| Cancellation | ADMIN PAID→CANCELLED; already CANCELLED no-op after auth, unpaid/PREPARING/READY/COMPLETED reject; aggregate immutable qty restore, exact original award reverse once, atomic; A00 §7, B16/DR14/DR15 |
| Payment/loyalty/snapshots | Keep Payment.status/amount/paidAt and snapshots, no refund; COMPLETED no new award; [B10](B10_ORDER_CONTRACT.md), [B11](B11_PAYMENT_CONTRACT.md), [B14](B14_LOYALTY_CONTRACT.md), [B15](B15_ORDER_HISTORY_CONTRACT.md), B16 |
| Frontend | A02 detail actions only explicit click/current role+status, cancel confirmation/no refund warning, synchronous action gate, fresh GET after success/lost response,409 read reload/new confirmation, session/unmount discard; A00 §7/12 |
| Acceptance | AS-T06–08/14 security/graph/version/races/rollback/stock/award/payment/lost-response/customer visibility/browser390/768/1366; A00 §14 |

No essential contract/open decision missing (A00 §16/D35–38/DESIGN_REVIEW closure). A04–A07/B17/redesign remain out of scope. B16 graph check precedes version check: duplicate already-completed edge409 INVALID_ORDER_STATE; stale version on a currently valid edge409 CONCURRENT_UPDATE. Both require GET/current-state review, not auto mutation. No change to this engine ordering.

## Permission matrix

| Capability | Guest/invalid | CUSTOMER | STAFF | ADMIN |
| --- | --- | --- | --- | --- |
| Operator GET list/detail |401|403|Allowed|Allowed|
| Preparation POST transitions |401|403|Allowed exact graph|Allowed exact graph|
| Admin POST paid-cancel, including repeated CANCELLED |401|403|403|Allowed B16 semantics|
| Direct Payment/Loyalty/Inventory/snapshot editing |No new endpoint|No new endpoint|No new endpoint|No new endpoint|

401 UNAUTHORIZED/403 FORBIDDEN/400 VALIDATION_ERROR/404 ORDER_NOT_FOUND/409 INVALID_ORDER_STATE or CONCURRENT_UPDATE/503 SERVICE_UNAVAILABLE follow shared sanitized envelope. Auth DB faults remain500. JWT role/header/body/userId cannot elevate current DB role. No operator registration/debug route. POST success private/no-store/Vary Authorization retaining Origin; no idempotency key/replay table added.

## Existing reuse and implementation plan

Existing RolesGuard, JwtStrategy, OrderModule/OrderService, A02 operator projections/frontend routes, B15 customer ownership, Payment lifecycle/inventory/loyalty engines all implemented. Only missing: authorized POST wrappers and operator action UI. Controllers authenticate/authorize/validate and directly invoke transitionOrder with original expectedVersion; no wrapper writes, stock/loyalty/Payment logic or new engine.

Frontend snapshot remains authoritative. While pending/confirmation/unreconciled/conflict, block simultaneous action/refresh; no optimistic status.200 means committed result, then GET supplies version. If subsequent GET fails, only retry GET, not confirmed POST. Ambiguous POST result first GET: if original source+version unchanged, permit explicit retry **original command**; if changed, display current and stop.409 never retries POST automatically.401 clears current session;403 clears private view; old response cannot alter another account. Reload/login reads current state, no automatic replay/advance.

## Verification plan and evidence

Backend HTTP: exact delegation/DTO/role matrix/current DB role/forged claim/errors/no secret/current response; PostgreSQL: actual checkout/PAID/preparation/cancellation/aggregate stock/original points/zero/repeat/races/lock/fault after each write/rollback/snapshot/Payment/customer visibility. Isolated UUID schema and own cleanup, no development reset. Frontend: role/status actions/confirmation/busy/conflict/refetch/error/ambiguous original-command/session/keyboard/VND. Real compiled browser + PostgreSQL customer checkout → STAFF workflow → customer COMPLETED; ADMIN cancel → customer CANCELLED/balance; dual-session stale conflict and direct permissions, all viewports, no production/debug data.

Full B04–B16/A01/A02 lint/build/tests/PostgreSQL/Prisma mandatory. Preserve historical evidence; A03 prefix. READY/checklist/local commit only after PASS, message `feat: implement BrewLite staff order workflow`, stage A03 only/exclude next-env/no push/global config. Human QA/Firefox/NFR01/full DoD/B17 not inferred.

## Actual results

Implemented [operator wrapper](../backend/src/orders/operator-order.controller.ts), [ADMIN wrapper](../backend/src/orders/admin-order.controller.ts), [strict DTO](../backend/src/orders/order-workflow.dto.ts) and existing OrderModule wiring. OrderService differs only in a comment; transitionOrder function body/graph/transaction/OCC/restock/reversal remain unchanged. [Workflow client](../frontend/src/lib/api/operator-workflow.ts) passes original command, whitelists errors and discards old-session responses; [controls](../frontend/src/components/operator-workflow.tsx) synchronous ref gate/inline confirmation/reconciliation/coherent GET and A02 view integration. Only frontend action availability represents graph; backend B16 is authority.

| Check | Observed result |
| --- | --- |
| npm.cmd run test --workspace backend |11 suites232/232 PASS:195 baseline +37 A03 wrapper/security/DTO/error cases |
| npm.cmd run test --workspace frontend |130/130 PASS:116 baseline +14 A03 action/role/confirmation/busy/errors/session/original-command cases |
| npm.cmd run test:database |14 isolated suites318/318 PASS:296 baseline +22 A03 actual HTTP/DB workflow/cancellation/race/rollback/owner-lock cases |
| npm.cmd run lint / npm.cmd run build | Both workspaces PASS; frontend/backend compiled successfully |
| db:format / db:validate / db:generate / db:status | PASS,3 migrations up to date, no schema/migration diff |
| npm.cmd run test:workflow:browser --workspace frontend | PASS real Edge155.0.4283.45 +compiled Next/Nest/PostgreSQL UUID schema; full customer/A01/A02+A03 scenarios, cleanup/public fingerprints |

[HTTP tests](../backend/test/operator-workflow.spec.ts), [PostgreSQL tests](../backend/test/database/operator-workflow.spec.ts), [frontend tests](../frontend/test/operator-workflow.test.mjs). Real HTTP customer checkout creates PAID, STAFF/ADMIN exact graph, customer history COMPLETED; cancel aggregates qty3+1 across2 products, reverses12/zero/historical7 points exactly once, Payment/paidAt/items/Cart/claims unchanged. Auth/forged claim/DB demotion, skipped/terminal/stale graph/version ordering, two STAFF sessions, ADMIN cancel-vs-prepare and repeated cancel verified. Actual AFTER UPDATE faults at Order/second sorted Product/award/user balance rollback all rows; owner FOR UPDATE lock timeout409, operator-user lock does not block engine owner path. Customer Payment race/replay preserves balance and immutable payment; baseline B16 suites remain enabled. No NFR01 PASS inference.

## Browser environment and diagnostics

A03 browser uses [compiled test server](../backend/test/workflow-browser-server.cjs) and [factory](../backend/test/browser-app.cjs): exact production AppModule/controllers/services, only Prisma adapter schema overridden in test harness.3 existing migrations +existing [seed](../backend/prisma/seed.cjs) apply only to owned UUID schema, both ORM schema/raw search_path scoped. No production debug/provision/state bypass. Compiled [frontend build snapshot](../frontend/test/workflow-build.mjs) copies current src/public/config to owned `.tmp/a03-frontend-build`, shared dependencies/no install,3100/3101; `.env`, default dev config3000/3001 and existing user servers untouched. CDP driver resolves default test URL literals to actual test origins before sending commands; frontend itself is built with real NEXT_PUBLIC_API_BASE_URL3101, no network redirect/proxy. Network evidence records actual origins. Schema cleanup compares all public16-table fingerprints before/after; historical images/reports preserved by A03 prefix/current_schema-aware test helpers.

Development diagnostics (evidence kiểm thử cũ đã dọn): existing Next dev log shows hydration mismatch only for DOM `bis_skin_checked` attributes on public menu. Attribute absent from frontend source and clean guest profile (extensions disabled); external DOM injection inferred, not proven application defect. Clean profile `/`, `/login`, `/operator/orders`: zero runtime exceptions/hydration warnings/red badges, **2 Issues NOT REPRODUCED in that profile**. Do not claim the user's profile issue fixed; no suppressHydrationWarning/browser-setting change/server stop.

Preliminary browser failures: occupied development3000/3001 led to dedicated ports/schema/source snapshot; programmatic focus did not imply focus-visible, driver now navigates by real Tab then Enter character event; final Network assertion still referenced3001 instead of actual3101 and was corrected. No business engine workaround or disabled assertion. Every reached isolated run cleaned own schema/public fingerprints; failure before free-port setup created no schema. A04–A07 remain PLANNED.

## Final browser evidence, checklist and limitations

Browser/network evidence (evidence kiểm thử cũ đã dọn), regression summary (evidence kiểm thử cũ đã dọn). Customer real checkout/Payment SUCCESS fixtures →STAFF exact3 preparation edges →customer COMPLETED. Another PAID Order →ADMIN inline confirm→CANCELLED with aggregate stock restored/original award reversed once; Payment/amount/paidAt/snapshot unchanged, customer history/payment status/balance correct. STAFF paid-cancel403 including CANCELLED, CUSTOMER mutation403, PREPARING cancel409; separate authenticated STAFF B advances the Order while UI A keeps original version, stale click409 and read/new confirmation only. List re-entry/filter removes COMPLETED from PAID filter, refresh/re-login and role isolation verified.

Blocked pre-commit transport yields original source/version and **explicit original-command retry**; double invocation while response held produces only one POST. Lost committed preparation response GETs current READY and stops;200 COMPLETED plus failed GET disables old actions and only retries GET. No optimistic success or automatic next step. Responsive390/768/1366 no overflow, actions45px, real Tab/focus/Enter. Staff390 (evidence kiểm thử cũ đã dọn), 768 (evidence kiểm thử cũ đã dọn), 1366 (evidence kiểm thử cũ đã dọn), ADMIN confirmation390 (evidence kiểm thử cũ đã dọn), 768 (evidence kiểm thử cũ đã dọn), 1366 (evidence kiểm thử cũ đã dọn) reviewed; BrewLite theme retained. A03-prefixed baseline screenshots preserve A01/A02 artifacts. All fixture schema removed and all16 public development table fingerprints unchanged; existing servers left running.

README/API_DESIGN/DEVELOPMENT_PLAN/TRACEABILITY_MATRIX/A00 updated. No DECISIONS change: D35/D36/A00 already approve exact business behavior; isolated test ports/schema/source snapshot are test tooling, no design/business baseline change. Next-env exact pre-flight bytes/hash preserved and excluded. Local commit message `feat: implement BrewLite staff order workflow`, hash reported from Git after commit; only A03 staged, no remote/push/global config.

Remaining: user's browser-profile DOM attribute hydration warnings not claimed fixed; clean-profile diagnostics distinguish them from application behavior. Known pg concurrent-query deprecation/D33 worker recycling remain; no native crash observed in completed318-test regression. Memory JWT/re-login policy and logout-local expiry limitation unchanged; last-login role UI hint can be stale but next-request DB permissions authoritative. Workflow transport command kept in mounted session only; after full reload/re-login read current state, no automatic replay. Human manual QA/Firefox/NFR01/team/full DoD/Compose/B17 not claimed. A04–A07 **PLANNED**, AD01/AD02 approvals unchanged; A04 must be assigned separately.
