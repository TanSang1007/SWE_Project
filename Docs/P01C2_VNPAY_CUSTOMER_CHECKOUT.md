# P01-C2 PAYMENT CONFIG & CHECKOUT RESULT

## Approved FIX01 and resumed C2 — 2026-10-18

**P01-C2 COMPLETE — READY FOR SANDBOX ACTIVATION PREPARATION**.

C2-PROVIDER-01 was resolved by explicit user approval for CUSTOMER-authenticated
GET /payments/config, followed by permission to resume C2 after its test gate.
The original audit below remains historical evidence; its BLOCKED/unimplemented
statements do not describe the resumed implementation. P00 remains FROZEN.

Actual baseline remains `959550a0ed95ae86206f506ff745d72c5d3b1c6f` (committed C1).
Initial changes were this report, Development Plan and unrelated next-env; all
were retained. No schema/migration/financial-engine/feature-gate changes.

### Config API and FIX01 gate

[PaymentConfigController](../backend/src/payments/payment-config.controller.ts)
is registered in PaymentModule. Existing JwtAuthGuard resolves identity/current
database role; RolesGuard requires CUSTOMER. Missing/invalid/expired/deleted
identity401; STAFF/ADMIN403 even if token says CUSTOMER. Strict empty query/body,
unknown fields400. Exact200 DTO contains providerMode only. Private no-store,
Vary Authorization/Origin. No DB write/transaction, financial service or network
dependency; only existing JWT identity read.

Mode comes from validated ConfigService. Explicit MOCK is returned as MOCK.
Selected VNPAY requires normalized config and successful revalidation through the
unchanged initiationSettings synthetic gate, including test-only flag/matching
isolated database/approved synthetic credentials. Missing/invalid config, closed
gate or unknown mode503 PAYMENT_UNAVAILABLE, never MOCK. No merchant, signed URL,
secret, feature-gate internals or raw environment output. No provider-setting API.
[Additive API contract](API_DESIGN.md) records the user-approved extension.

Before frontend work:17 new config +20 initiation unit/HTTP tests PASS;43 isolated
PostgreSQL Mock Payment tests PASS. The first invocation included a nonexistent
unit path for database payments; corrected invocation passed37/37. No failing
assertion was bypassed. Config tests cover exact DTO, mode/gate/credential errors,
JWT/DB roles, strict inputs, headers, no financial dependency and route isolation.

### Checkout and Order confirmation

[OrderCheckout](../frontend/src/components/order-checkout.tsx) waits for a valid
session-bound config read. Loading/error/retry never selects a provider implicitly.
Config lives in memory and is not persisted as authority. Backend mutations still
recheck gates. Existing B10 Order creation/payload/key/snapshot/replay, Cart locking,
promotion and Loyalty pricing are retained. Customer never sends final amount,
provider, merchant, outcome or BankCode.

Positive MOCK retains existing WALLET/CARD selector, POST /payments and historical
Mock accounting. VNPAY hides that selector; exact primary button **Thanh toán**,
amount displayed separately. Existing uncertain Mock context blocks a gateway
mutation rather than translating it. There is no automatic gateway→Mock fallback.

[GatewayCheckout](../frontend/src/components/gateway-checkout.tsx) reads owned
current Attempt before enabling actions. New positive initiation only for PENDING
with no Attempt; existing Attempt resumes only with canResume and saved exact key.
Verified FAILED retry requires canRetry and explicit Customer click. UNKNOWN/REVIEW
cannot resume/retry/cancel through this UI. Verified failure cancellation follows
canCancel even when the terminal intent is saved; backend revalidates races.

POST /payments/vnpay/attempts sends only `{orderId}` with Idempotency-Key. A
synchronous ref plus disabled states prevents double-submit. Same pending intent
keeps its key after5s timeout, technical/key conflicts or redirect failure. Only
known terminal verified failure with current canRetry permits a fresh intent on an
explicit click; an uncertain intent without returned ID must replay first.

[Order confirmation](../frontend/src/components/order-history-view.tsx) reads
current Attempt for positive totals; labels terminal local Payment as historical
and separately presents current status/result link. A previous FAILED record is
not treated as evidence that a pending retry failed. If status cannot be read,
the page warns instead of deriving retry capability from that record. All-cache
loss recovery remains owned Order history → detail → current Attempt/result or Cart.

### Zero-total and browser navigation

Immutable Order total exactly0 gets explicit **Xác nhận đơn 0 VND** (P00 §14),
including in normal MOCK mode. It uses only POST /orders/:id/confirm-zero with JWT,
empty body and stable key. No Attempt/gateway/Mock call, fake IPN, frontend award,
balance write or frontend PAID flag. Parsed INTERNAL_ZERO/ZERO_TOTAL success is
followed by current Order/Cart read. Award0/EARN0/SETTLE/stock/Cart remain backend
responsibility and are covered by the unchanged PostgreSQL financial suites.

Only authorized initiation response supplies paymentUrl. Client checks the same
P00 HTTPS exact Sandbox host and `/paymentv2/vpcpay.html` path, rejecting credentials,
fragment, alternate host/path/protocol. URL is never built/signed/repriced or put in
storage; window.location.assign is the navigation mechanism. Before redirect,
sessionStorage contains only owner/userId, orderId, key and optional attemptId.
Blocked/unreadable storage prevents a new mutation. An existing pending Attempt
without its saved key can be inspected but cannot become a new charge; the page
explains safe recovery. A signed URL is obtained again only via exact-key replay,
then current status/canResume is checked before navigation. Expired URLs or
nonresumable status lead to result rather than a new Attempt.

### Result, authentication and polling

Route [payments/vnpay/result](../frontend/src/app/payments/vnpay/result/page.tsx)
accepts only a single UUID attemptId (normalized lowercase). Extra provider/status
queries and malformed/missing context are generic invalid Return. It does not
interpret vnp_ResponseCode. C1 public Return remains fixed303/read-only; IPN and
gated QueryDr remain financial authorities. No financial mutation occurs on page
mount, navigation, polling or manual refresh.

[PaymentResult](../frontend/src/components/payment-result.tsx) shows generic login
without JWT; no anonymous status read or Order/amount details. Existing B07 memory
JWT is preserved: full redirect/reload can require login. Login returnTo is exact
internal result route+UUID; no arbitrary redirect/JWT URL or token persistence.
Valid session reads GET /payments/attempts/:attemptId;401 clears session, wrong
role shows safe text,404/cross-owner shows generic unavailable ownership result.
Account changes/unmount abort requests or discard late responses; ID is context,
never authorization.

Status UI: AWAITING/PENDING shows **Đang xác minh kết quả thanh toán.** Success
requires backend effective SUCCEEDED, APPLIED, bound Payment and paid-family Order;
only then **Thanh toán thành công.** Verified FAILED shows **Thanh toán không thành
công.** and retry link only with current canRetry. UNKNOWN explicitly says result
undetermined/do not pay again; REVIEW says under investigation/do not pay again,
including PAYMENT_RECEIVED_REVIEW wording. Paid cancellation separately explains
Order cancelled/payment recorded/no automatic cash refund. Invalid Return never
guesses success or failure.

[Poller](../frontend/src/lib/payment-result.ts) performs serial owned status GET,
3s between completed reads, with a hard60s abort deadline (including hidden time).
Hidden tabs skip reads. It stops on terminal/UNKNOWN/REVIEW, error, logout/unmount;
cleans timers and aborts outstanding requests. Maximum20 fast reads per automatic
window. Deadline is not FAILED; manual recheck opens another bounded window.
No new Attempt, QueryDr, release or retry charge is triggered by polling.

### Verification and preservation

| Check | Current resumed result |
| --- | --- |
| Backend unit/HTTP |745/745 PASS,25 suites (728 baseline +17 config) |
| Full isolated PostgreSQL |692/692 PASS,25 suites; all financial/Loyalty/inventory/Mock/Return cases retained |
| Frontend full suite |228/228 PASS (191 baseline +37 C2) |
| Both lint/typecheck/build |PASS; frontend build from source snapshot, root next-env untouched |
| Prisma validate/status/diff |PASS;13 up to date; no schema difference |
| Development READ ONLY |19 fingerprints/catalog/13 ledger+SQL checksums preserved against C1/FIX01 |
| Real Edge/synthetic transport |10 groups PASS;390/768/1366, keyboard,0 runtime exceptions/0 hydration warnings/0 actual gateway calls |
| P00/schema/13 migrations/financial engines |Unchanged; source/secret/link review required before local commit |
| Actual Sandbox E2E |NOT RUN |

Frontend tests cover API bodies/keys/errors, exact config parsing/no fallback,
gateway allowlist, zero result, intent retention, storage failure/isolation,
ownership/expired auth/account switches, status presentation, paid cancellation,
historical failed versus pending retry, safe returnTo, hidden/deadline/unmount
polling. Fake scheduler proves20 reads/60s, no terminal polling or timeout→FAILED.

Real Edge uses an isolated Next source build on3200 and **synthetic frontend HTTP
transport** on3201, no database. CDP intercepts gateway navigation at request stage
and returns local204; no actual VNPAY request. Tests exercise390/768/1366 layouts,
keyboard/disabled states, double-click,5s timeout/same-key replay, Order creation
uncertainty, config failures/no fallback, Mock, zero, lost auth/relogin, ownership,
all result states and current Order status. This is not real gateway E2E or a claim
that the synthetic HTTP server verifies JWT/settlement; those are backend/PG tests.
Browser CDP required approved execution outside the filesystem sandbox. Existing
PG concurrent-query deprecation warnings and negative503 logs are not assertions.

Machine evidence (evidence kiểm thử cũ đã dọn); local commit SHA is reported
in the final response/Git history (not embedded in its own content). No baseline
tests removed/skipped. `frontend/next-env.d.ts` remains byte-exact and excluded.
Only scoped changes are staged after source/secret/link review. No push/deploy/
activation is authorized by this result.

### Feature gate and P01-D prerequisites

MOCK remains default. VNPAY development/production activation remains denied by
the unchanged test-only gate. QueryDr transport stays gated; **external response
compatibility PENDING**. No actual credentials, merchant setup, ngrok, public
backend, live gateway traffic, automatic refund, deployment or push.

P01-D is ready for separately assigned activation preparation; actual activation still
requires a separate assignment, merchant/config validation, callback-only HTTPS
ingress/registration/TLS verification, external QueryDr response compatibility and
representative Sandbox transaction/Return/IPN/late-outcome tests. Synthetic success
does not prove any of those external prerequisites.

---

## Original C2 audit — preserved history, superseded by approval above

Ngày kiểm tra: 2026-10-18. **P01-C2 BLOCKED — APPROVAL REQUIRED**.
P01-C1 verification gate PASS; chưa triển khai application code P01-C2.

## Git baseline và phạm vi

HEAD thực tế: `959550a0ed95ae86206f506ff745d72c5d3b1c6f`,
`feat: implement read-only VNPAY browser return`. Parent là last-confirmed commit
`8e94b84e6c3f5e233a57a5cb646c63b5bd5bde4a`. P01-C1 đã commit;
không có thay đổi C1 chưa commit trong backend.

Working tree ban đầu chỉ có `frontend/next-env.d.ts` modified. File giữ SHA256
`0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc`;
không sửa/stage. Lượt này chỉ tạo báo cáo và cập nhật trạng thái Development Plan.
Không sửa P00, B07, L00/L01, API, application code, schema, migration hoặc env.

## P01-C1 verification gate

Đối chiếu [báo cáo C1](P01C1_VNPAY_BROWSER_RETURN.md),
machine evidence (evidence kiểm thử cũ đã dọn) và source thực tế:

| Mandatory check | Kết quả |
| --- | --- |
| HEAD / working tree / commit | Commit C1 ở HEAD; chỉ next-env modified từ trước |
| GET `/payments/vnpay/return` | Controller đăng ký trong PaymentModule, public GET, no-store/no-referrer |
| HMAC / merchant | Shared raw parser, HMAC-SHA512/timingSafeEqual, merchant trước DB lookup |
| Reference / amount | Stored ref, exact minor amount, immutable Order total và initiation snapshot/owner/claim binding |
| HTTP303 / destination | Fixed `http://localhost:3000/payments/vnpay/result`; valid context chỉ thêm UUID attemptId |
| Open redirect | Host/Forwarded/body/next/returnUrl không chọn destination; invalid origin503/no Location |
| Financial writes | Resolver chỉ Prisma/Config; transaction READ ONLY trước lookup; không gọi financial services |
| Return trước/sau IPN | Signed Return giữ PENDING trước IPN; sau IPN không lặp settlement; races có một effect set |
| UNKNOWN / REVIEW | Return không clear, retry, release hoặc ghi Verification |
| Source/evidence | SHA256 của toàn bộ7 source/test files trong C1 evidence khớp working tree |
| Synthetic PostgreSQL chạy lại | 25/25 PASS,1 suite, isolated `brewlite_b2a_9482714fd97d_test`, UUID schema cleanup |

PostgreSQL tests chạy lại kiểm tra mọi table/sequence fingerprint trước/sau Return,
success/failure/invalid/expired/repeated callbacks, ownership và Return/IPN races.
Không tạo synthetic data trong development; không gọi gateway.
Log ignored: `.tmp/c1-dev-initiation.log`, JSON `.tmp/c1-dev-initiation.json`.
Full backend unit/HTTP rerun được ghi ở phần kiểm chứng bên dưới.

## C2-PROVIDER-01 — thiếu contract đọc provider cho Checkout

Yêu cầu hiện tại giới hạn C2 ở UI/frontend integration, đồng thời yêu cầu backend
quyết định provider, giữ Mock baseline và ẩn WALLET/CARD trong VNPAY mode.

Audit [backend config](../backend/src/config/environment.ts),
[initiation gate](../backend/src/payments/vnpay/initiation-config.ts),
[Payment controller](../backend/src/payments/payment.controller.ts),
[Attempt controller](../backend/src/payments/attempt.controller.ts),
[Order response](../backend/src/orders/order.service.ts),
[health](../backend/src/health.controller.ts),
[frontend env](../frontend/src/lib/env.ts) và
[API contract](API_DESIGN.md) cho thấy:

- `PAYMENT_PROVIDER_MODE` chỉ tồn tại trong backend config; frontend chưa có
  provider discovery API hoặc server-supplied Checkout config.
- POST `/payments/vnpay/attempts` là mutation, không phải mode discovery. Gate OFF
  trả503 PAYMENT_UNAVAILABLE;503 cũng không chứng minh cần chuyển sang Mock.
- GET `/orders/:id/payment-attempts` trả `current:null,items:[]` khi chưa có Attempt,
  trong cả MOCK và VNPAY mode. Không thể chọn provider cho lần thanh toán đầu từ đó.
- GET `/payments/attempts/:attemptId` cần Attempt đã tồn tại. GET Order giữ DTO cũ,
  không trả provider cấu hình. GET `/health` chỉ trả `{status:"ok"}`.
- Checkout hiện gọi `/payments` với method WALLET/CARD; Next config chưa có cầu nối
  đọc backend mode. Response login cũng không cung cấp payment configuration.

Vì vậy frontend hiện chưa có nguồn đọc authoritative để chọn đường thanh toán đầu
và render selector phù hợp. Không dùng mutation probing, lỗi503 để fallback Mock,
Customer query/body provider selector hoặc một frontend mode độc lập làm giải pháp.
Đây là khoảng trống integration contract, không phải lỗi financial engine C1 và
không phải blocker về an toàn của memory JWT.

## Đề xuất cụ thể cần phê duyệt — chưa phải contract hiện hành

Xin mở rộng phạm vi bằng **một API đọc cấu hình tối thiểu**:

| Thuộc tính đề xuất | Giá trị |
| --- | --- |
| Route | GET `/payments/config` |
| Auth | CUSTOMER JWT + current DB role;401/403 theo baseline |
| Input | Empty query/body, reject provider/amount/outcome input |
|200 DTO | `{providerMode:"MOCK"}` hoặc `{providerMode:"VNPAY_SANDBOX"}`, lấy trực tiếp từ validated ConfigService |
| Cache | `private,no-store,max-age=0`, Vary Authorization/Origin |
| Effects | Không DB writes, không provider calls; không trả secret/merchant/URL/outcome/test switch |
| Failure | Không suy ra MOCK khi lỗi đọc; giữ nút disabled và cho đọc lại |
| Existing contracts | Giữ nguyên initiation/status/confirm-zero/Mock API và backend gates |

Phê duyệt cần bao gồm additive API contract trong API_DESIGN/traceability và task
backend nhỏ tương ứng, được ghi riêng với P00 FROZEN giữ nguyên. Endpoint chỉ cung
cấp UI hint; từng mutation vẫn tự kiểm gate/ownership/idempotency như hiện tại.
Không cần schema/migration, thay B07/L01 hoặc sửa financial architecture.
Đề xuất này chưa được implement hoặc coi là quyết định người dùng.

## Frontend integration và UI — NOT IMPLEMENTED

| Phần được giao | Trạng thái / hướng triển khai sau khi gỡ blocker |
| --- | --- |
| Routes/components | Chưa thêm `/payments/vnpay/result` hoặc component mới; đích C1 hiện vẫn có thể404 |
| Existing Checkout | Audit xong; giữ existing Order creation/key/snapshot/recovery, chưa sửa code |
| Positive initiation | Dự kiến `{orderId}` + stable Idempotency-Key tới POST `/payments/vnpay/attempts`; không amount/provider/BankCode input |
| Primary button | Dự kiến đúng `Thanh toán`, tổng tiền hiển thị riêng; VNPAY ẩn WALLET/CARD; Mock baseline giữ đường riêng |
| Zero total | Dự kiến explicit confirm-zero dựa immutable Order total0; không gọi gateway; Award0/EARN0 do backend |
| Redirect | Dự kiến chỉ backend-authorized URL có exact HTTPS gateway host/path đã approved; không tự dựng/ký URL |
| Recovery | Chỉ ownerId/orderId/attemptId/key trong sessionStorage theo P00; không JWT hoặc signed URL; retry request mạng chưa rõ giữ key |
| Result authority | Chỉ owned status GET; Return không phải bằng chứng PAID; không gọi Customer QueryDr |
| Session | B07 memory JWT hỗ trợ login lại; cần allowlist chính xác result route + UUID trong returnTo; không token persistence mới |
| Ownership |401 cần login;403/404 safe generic; cached attemptId không cấp quyền; account switch phải bỏ late response |
| Polling | Dự kiến3s, tối đa60s khi visible theo P00; cleanup/unmount/logout/terminal, pause hidden, manual refresh sau bound |
| PENDING | `Đang xác minh kết quả thanh toán.`; polling timeout không thành FAILED |
| PAID | Chỉ backend SUCCEEDED/APPLIED; paid cancellation tách Order cancelled và Payment đã ghi nhận/chưa tự hoàn tiền |
| FAILED | Chỉ verified local failed; retry/cancel theo current backend capabilities |
| UNKNOWN | Chưa xác định; không charge/release/retry tự động |
| REVIEW | Giao dịch cần kiểm tra; không charge mới; giữ PAYMENT_RECEIVED_REVIEW semantics |
| Invalid Return | Safe generic page; không đoán success/failure từ browser code |
| Responsive/accessibility |390/768/1366, keyboard/loading/disabled/error tests chưa thực hiện cho C2 |

Những mô tả dự kiến trên không phải implementation hoặc bằng chứng tests PASS.

## Kiểm chứng và bảo toàn

| Check trong lượt audit | Kết quả |
| --- | --- |
| C1 source hashes / committed source | PASS |
| C1 PostgreSQL synthetic HTTP/regression |25/25 PASS; không development fixtures |
| Full backend unit/HTTP |728/728 PASS,24 suites; gồm61 Return unit/HTTP cases;0 failed/pending |
| Prisma status / diff | PASS;13 migrations up to date; No difference detected |
| Development READ ONLY | PASS;19 fingerprints/catalog/13 ledger+checksums khớp C1 preflight và FIX01 baseline |
| next-env | Byte-exact, SHA256 như baseline; không stage |
| Full692 PostgreSQL /191 frontend | Historical C1 PASS với source hashes khớp; chưa rerun toàn bộ trong C2 audit |
| Frontend/backend lint/typecheck/build; Prisma validate | Chưa rerun trong lượt audit; không application/schema changes; không claim C2 PASS |
| Frontend component/unit/browser C2 | NOT RUN, chưa implementation |
| Actual Sandbox E2E | NOT RUN |

Development read-only proof dùng `.tmp/c1-prepare.cjs post`; Prisma dùng
`.tmp/c1-prisma.cjs status` và `diff`. Không apply migration/reset, không thay
financial engine, không xóa/skip test suite. Chưa đủ điều kiện tạo commit
`feat: integrate VNPAY customer checkout UI`; chưa stage/commit/push.

## Feature gate, security và prerequisites còn lại

Default MOCK, VNPAY OFF; synthetic test-only startup gate giữ nguyên. Không fallback
gateway→Mock, không frontend-only enable switch, secret/HMAC/JWT URL/signed URL storage
hoặc mutation từ Return. External QueryDr compatibility vẫn **PENDING**.

Cần phê duyệt provider discovery integration contract trước khi hoàn tất C2.
Sau đó mới implement và chạy đầy đủ mandatory C2 suites, lint/typecheck/build,
Prisma/preservation/security review, responsive/browser checks và local commit.
P01-D **NOT READY**. Merchant/callback/HTTPS ingress và actual QueryDr/Sandbox
verification tiếp tục là prerequisites riêng; không ngrok, activation hoặc deploy.
