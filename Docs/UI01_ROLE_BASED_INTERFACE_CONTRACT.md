# UI01 — Role-based Staff & Admin interface

2026-10-13. USER-APPROVED EXTENSION after A04, EXT-UI01, not a new PDF requirement. **UI01 READY (technical user scope).** Starting HEAD `f253f5385b16f80d247cec2c5aceb1c52f42c409`. Initial working tree only `frontend/next-env.d.ts`, preserved/excluded SHA256 `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`. PDF unchanged SHA256 `08EFC9A6CC247123500419F01160C76712EC773AFFC998D2193F2873EF5312CC`; read all eight pages.

## Approved scope and sources

User UI01 task authorizes distinct role experiences, redirects, STAFF queue/history, ADMIN overview/orders and A04 refinement. [D40](DECISIONS.md) intentionally supersedes A02's all-status STAFF reads and D38's ADMIN redirect; historical decisions/evidence retained. [A00](A00_ADMIN_STAFF_CONTRACT.md), [A01](A01_RBAC_AUTH_CONTRACT.md), [A02](A02_OPERATOR_ORDER_MANAGEMENT_CONTRACT.md), [A03](A03_STAFF_WORKFLOW_CONTRACT.md), [A04](A04_ADMIN_PRODUCT_MANAGEMENT_CONTRACT.md), [B15](B15_ORDER_HISTORY_CONTRACT.md), [B16](B16_ORDER_WORKFLOW_CONTRACT.md) remain baseline otherwise. AGENTS/README/requirements/design/API/database/architecture/plan/matrix reviewed; Q01–Q19/DR01–15 and AD01/AD02 resolved/scoped.

No schema/migration, auth persistence, login/register public DTO, price/workflow engine, refund, polling/WebSocket, pagination/search, customer management or revenue-reporting change. A05–A07/B17 PLANNED. Cold Brew zero-size/unavailable retained without repair. PDF unchanged; no push/remote/global Git config.

| Module/files | UI01 mapping |
| --- | --- |
| [Operator controller](../backend/src/orders/operator-order.controller.ts), [OrderService](../backend/src/orders/order.service.ts) | DB role propagated, server list/detail status scope, unchanged DTO/B16 |
| [Role policy](../frontend/src/lib/role-policy.ts), [SiteFrame](../frontend/src/components/site-frame.tsx), [OperatorShell](../frontend/src/components/operator-shell.tsx) | Shared-login defaults, compatible deep links, isolated customer/staff/admin chrome/expiry/logout |
| [Order view](../frontend/src/components/operator-orders-view.tsx), [workflow](../frontend/src/components/operator-workflow.tsx), frontend app admin/operator routes | Active queue, completed read-only, admin all statuses, A03 reconciliation |
| [Overview](../frontend/src/components/admin-overview.tsx), [Products](../frontend/src/components/admin-products.tsx), [styles](../frontend/src/app/globals.css) | Real counts, A04 table/cards/availability, operations-scoped tokens |
| [HTTP tests](../backend/test/operator-orders.spec.ts), [PostgreSQL](../backend/test/database/operator-orders.spec.ts), [UI tests](../frontend/test/ui01.test.mjs), [browser](../frontend/test/ui01-browser.mjs) | UI01-T01–08 with existing B04–B16/A01–A04 regressions |

## Shared login, redirects and layouts

Existing `/login` and POST `/auth/login` for all roles, email/password only; no selector/query role authority. Register always CUSTOMER. Safe compatible `returnTo` takes precedence for deep links; unsafe/incompatible destinations use role fallback. B07 JWT memory-only; refresh requires re-login; no refresh token/localStorage token.

| Role | Default | Frontend routes |
| --- | --- | --- |
| CUSTOMER | `/` | Existing shop/menu/detail/cart/checkout/payment/history/loyalty |
| STAFF | `/operator/orders` | Queue, `/operator/orders/completed`, `/operator/orders/[id]` |
| ADMIN | `/admin` | Overview, `/admin/orders`, `/admin/orders/[id]`, `/admin/products` |

Existing ADMIN operator deep links remain compatible with the same business source. SiteFrame selects customer versus operations chrome by pathname. OperatorShell guards children, supplies role/user display, logout and expiry. STAFF navigation only queue/completed, no customer/admin links. ADMIN sidebar/topbar only overview/orders/products; future module links hidden.

## Approved operator API contract change

JWT→DB RolesGuard; controller passes DB-resolved request.user.role. JWT/header/query claims cannot elevate authority. Guest/invalid/expired401; CUSTOMER403 before resource lookup. Customer GET `/orders/me` and `/orders/:id` retain CUSTOMER ownership.

| Read | STAFF | ADMIN |
| --- | --- | --- |
| GET `/operator/orders`, omitted status | PAID/PREPARING/READY | All seven states |
| Exact PAID/PREPARING/READY/COMPLETED | Exact status | Exact status |
| Exact PENDING/PAYMENT_FAILED/CANCELLED | 403 FORBIDDEN | Exact status |
| GET `/operator/orders/:id` | PAID/PREPARING/READY/COMPLETED only; outside scope404 ORDER_NOT_FOUND | All states; missing404 |

Hidden/missing detail share404; scope in Prisma WHERE, not frontend hiding. Unknown/multiple/lowercase/extra query/body400 unchanged. Sorting `createdAt DESC,id DESC`, no search/pagination/truncation. Exact A02 summary/detail snapshots/version/updatedAt/Payment projection unchanged; no owner PII/internal keys. private/no-store/max-age=0/Vary Authorization preserving Origin. GET never writes Order/Payment/stock/Loyalty/Cart/claim/timestamps.

## Queue, history and A03 reuse

STAFF default queue uses unfiltered GET; selector only PAID/PREPARING/READY; cards retain server sort and existing code/time/status/total/revision. No invented item/payment summary fields. Completed route requests `?status=COMPLETED`, read-only snapshot/detail with no workflow/cancel. Loading/empty/error/Retry/reload use fresh reads, no polling/fake data.

A03 POST `/operator/orders/:id/transitions` retains PAID→PREPARING→READY→COMPLETED, original expectedVersion/pending gate/OCC409/reconciliation; labels Bắt đầu pha chế / Đánh dấu sẵn sàng / Hoàn thành đơn. No optimistic success. Fresh detail after server-confirmed completion returns STAFF to a re-fetched active queue; history fetch shows COMPLETED. ADMIN retains all-status snapshot/payment/version and A03 actions, POST `/admin/orders/:id/paid-cancel` confirmation/PAID-only/atomic stock restore/exact Loyalty reversal/Payment SUCCEEDED/no refund.

ADMIN cancellation of open STAFF PAID detail: reload/conflict reconciliation returns404, clearing snapshot/actions; queue reload removes it, no auto mutation retry. Logout/switch unmount session-keyed views/abort reads; API clients discard old token/user/role responses, including delayed401. Last-login role hint can be stale, but next backend request resolves current DB role.

## Admin overview, products and design

Overview counts seven statuses from real authorized GET data at last load; no revenue/net-sales/fake stats/new endpoint. Existing unpaginated demo scalability limit remains, no NFR01 inference. Product desktop table/mobile labeled cards, name/VND/stock read-only/isActive/derived availability/options/create/edit/toggle/safe-delete. Availability derives active AND stock>0 AND size present from A04 DTO; no response-field change. Existing inline labeled form/confirmation retains strict DTO/required sizes/shared-version OCC/409/retained Cart/current checkout validation. No stock form/A05 management.

Operations-scoped cream/coffee/olive/amber/restrained-red tokens, consistent typography/button hierarchy/status badges/cards/table/sidebar/topbar. Customer styles preserved.44px controls/focus/semantic labels/table headers/skip link; inline native confirmations, no modal focus trap required. Browser verification required at390/768/1366; CSS alone does not prove accessibility/overflow PASS.

## Pre-flight and required acceptance

HEAD/initial status directly confirmed; Prisma4 migrations up to date, no reset/deploy. Sandbox setup fails `helper_unknown_error: setup refresh had errors`; read/verification commands explicitly escalated. Git ownership handled with command-local `git -c safe.directory=D:/CNPM`, no global config. Hydration evidence and limits below; no FIXED claim.

UI01-T01 redirects/deep links/refresh/logout/switch/expiry; T02 layouts/nav/guards; T03 STAFF scope/filter403/detail404/forged authority/DB role/ADMIN seven states/ownership; T04 queue/history/workflow/completion/cancellation race/conflict; T05 A04 CRUD/OCC/delete/availability; T06 loading/error/Retry/keyboard/focus/responsive; T07 isolated PostgreSQL/GET fingerprints/stock-Loyalty-Payment/concurrency/customer regression; T08 full B04–B16/A01–A04 lint/build/tests/Prisma; T09 documents/protected hashes/scope/Git.

| Check | Actual result |
| --- | --- |
| Backend lint/build/tests | PASS both lint/backend build;12 suites291/291 |
| Frontend lint/build/tests | PASS lint/source-snapshot Next production build;152/152 |
| Isolated PostgreSQL integration/security/transactions/concurrency | PASS15 UUID suites347/347 |
| Browser real Next/Nest/PostgreSQL A–L/customer regression | PASS Edge155.0.4283.45;29 check groups; compiled source snapshot/3100–3101/owned PostgreSQL UUID schema |
| Prisma format/validate/generate/status | All four PASS;4 migrations up to date, no schema/migration content diff |
| Responsive/accessibility/hydration | PASS390/768/1366 no overflow,44px navigation/45px actions, keyboard Tab/Enter/focus/labels/inline confirmations; clean compiled browser0 runtime exceptions/0 hydration warnings |
| Protected hashes/docs links/diff | PASS10 Markdown/287 local links, PDF/next-env bytes intact/schema/migrations/lockfile/AGENTS unchanged/B16 engine unchanged; diff --check PASS |

## Actual evidence, corrections and limits

Full regression summary (evidence kiểm thử cũ đã dọn), real browser/network/cleanup (evidence kiểm thử cũ đã dọn), development hydration diagnostic (evidence kiểm thử cũ đã dọn). Browser A–L includes customer login/home, STAFF default queue, ADMIN default actual overview, all seven legal fixtures created via real customer Cart/Order/Payment/A03 APIs, STAFF denied filter/direct API/detail URL, completed history read-only, original STAFF workflow/conflict/lost response/double-click, ADMIN all filters/detail/counts/paid-cancel, A04 CRUD/availability/cart/snapshot/delete regression, logout/switch/refresh/DB role and responsive/focus/inline confirmations. Exact GET fingerprints preserved. UUID test-only stock setup supplies fixture stock, no inventory endpoint/fake backend statuses. Own fixture IDs removed and catalog stock/version/timestamp restored; outer schema drop and all development public-table fingerprints unchanged.

Screenshots reviewed: STAFF mobile queue (evidence kiểm thử cũ đã dọn), Admin Orders desktop (evidence kiểm thử cũ đã dọn), Product table (evidence kiểm thử cũ đã dọn), Product mobile (evidence kiểm thử cũ đã dọn), Product form (evidence kiểm thử cũ đã dọn). Existing customer B04–B16/auth/catalog/Cart/checkout/Payment/Promotion/Loyalty/history and A01–A04 security/transaction/concurrency suites remain enabled. No production/debug endpoint or schema/engine rewrite.

Before final PASS: frontend label expectation updated to approved READY label; PostgreSQL literal typing and old STAFF27-order assertion updated to actual ADMIN all-status contract; browser harness awaited Product GET, corrected customer versus operations selectors, and returned original customer session after new scenarios. All assertions remain enabled. Three earlier browser failures cleaned owned schema and preserved development fingerprints; successful final run completed full regression. Audit initially compared a trimmed Git blob with untrimmed file suffix, then corrected whitespace normalization; actual B16 source body is unchanged. Screenshot review refined scoped ink, Create button hierarchy and mobile logout wrapping.

Next development diagnostic opens login/register and four guest operator/admin routes in an independent source snapshot/clean Edge headless profile: no client/server hydration warnings/runtime exceptions, no injected extension attributes, correct shop versus operations chrome. **NOT REPRODUCED in tested clean development/compiled profiles**, not FIXED; original user's browser profile not inspected, root cause unproven. No suppressHydrationWarning/workaround.

Human manual QA/screen-reader testing, Firefox/full browser matrix, NFR01 latency, team review/full DoD/Compose remain pending, not inferred PASS. Known pg concurrent-query deprecation/D33 recycling retained; no native crash in completed suite. Unpaginated lists/overview remain approved demo contract; no scalability SLA. Memory session requires login after refresh; DB authority next request despite stale last-login role hints. A05 prerequisites A01/A04/B05/B08/B09 and AD02/D37 are available; A05–A07/B17 remain PLANNED, not started.

Requested local completion checkpoint message `feat: refine BrewLite role based admin staff experience`; hash reported after commit, not embedded in its own content. Stage only UI01 sources/tests/docs/evidence; exclude next-env/build/generated/unrelated files. No push/remote/global config change.
