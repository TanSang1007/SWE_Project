# Checkout, payment expiration và persistent session — 2026-10-22

Đây là thay đổi được người dùng giao triển khai, supersede phần Cart khóa ở B10/D31, JWT chỉ bộ nhớ không khôi phục ở B07/D19 và Attempt TTL 900 giây ở P00. Không sửa PDF. Baseline PDF và các acceptance cũ vẫn là lịch sử; nghiệp vụ mới dưới đây là user-approved amendment.

## Nghiệp vụ và API

- Transaction `POST /orders` khóa user, giữ active-order guard, kiểm tra full Cart, giá/tồn/điểm như trước; tạo snapshot PENDING và lấy các dòng Cart hiện tại ra khỏi Cart trong cùng transaction. Cart mới có thể thêm/sửa/xóa ngay, bao gồm cùng cấu hình sản phẩm. Không thay snapshot Order. Nếu tạo Order rollback, Cart cũng rollback.
- Settlement MOCK, INTERNAL_ZERO và VNPAY không đọc/kiểm tra/xóa Cart. Vì vậy Cart B không mất dòng khi A thành công, thất bại, bị hủy hoặc nhận IPN muộn. Đơn đang chờ trước migration không bị sửa dữ liệu; Cart hiện tại của chúng tiếp tục chỉnh sửa và không bị settlement xóa.
- `GET /orders/active`: CUSTOMER/JWT, trả `{order: <owned detail>|null, serverNow}`. PENDING/PAYMENT_FAILED của cùng user chặn tạo mới; không khóa admission của khách khác. `POST /orders`/preview tiếp tục enforce guard trong backend, lỗi409 `INVALID_ORDER_STATE`, `details.existingOrderId`. Không tạo Order/Attempt B khi bị chặn.
- Response create/detail Order bổ sung `paymentStartedAt`, `expiresAt`, `paymentExpiredAt`, `cancellationReason`, `serverNow` (ISO UTC, nullable cho lịch sử). Lịch sử không được backfill deadline. Idempotency replay giữ nguyên snapshot/deadline; frontend đọc lại detail để lấy `serverNow` mới.
- Deadline bắt đầu khi snapshot PENDING được commit từ thao tác xác nhận Order: thời điểm backend chuẩn hóa tới giây, cộng đúng600 giây. Hai bước create Order/initiate Attempt vẫn dùng API/idempotency hiện có; chậm giữa hai bước không cấp thêm thời gian. MOCK/zero cũng không được xác nhận mới sau deadline.
- Attempt mới của Order có deadline dùng chính `Order.paymentExpiresAt`; retry FAILED chỉ khi trước deadline và toàn bộ guards cũ hợp lệ. Legacy Order không có deadline tiếp tục giữ lịch sử; Attempt mới dùng600 giây. Attempt cũ giữ nguyên expiry/signature/evidence đã lưu.
- `POST /orders/:id/payment-resume`: CUSTOMER/JWT, empty body/query, private/no-store; trả body initiation đã lưu, bao gồm URL đã ký và expiresAt. Chỉ latest AWAITING/PENDING chưa hết hạn, không REVIEW/receipt chờ xử lý, còn admission hợp lệ. Không tạo claim/Attempt mới. Không cần key ở sessionStorage để khôi phục trên tab/trình duyệt khác. Sai owner404; hết deadline409 `PAYMENT_TIMEOUT`; state không hợp lệ409 `INVALID_ORDER_STATE`.
- Initiation replay hết hạn trả409 `PAYMENT_TIMEOUT`, không trả URL cũ. Attempt status bổ sung `serverNow`, giữ `expiresAt` và capabilities của backend.

VNPAY `vnp_ExpireDate` dùng expiry tương ứng, GMT+7 `yyyyMMddHHmmss` theo [đặc tả chính thức](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html). `VNPAY_ATTEMPT_TTL_SECONDS`, nếu khai báo, phải là600; bỏ giá trị900 trong cấu hình mới. Không sửa thông số đã ký của Attempt cũ.

## Hết hạn và financial consistency

`PaymentExpirationWorker` chạy lúc startup và mỗi5 giây, lấy tối đa50 Order có deadline quá hạn. DB là hàng công việc bền vững; backend ngừng hoạt động thì xử lý bù sau restart. Không cam kết thực thi đúng mili giây600000 khi process/DB không hoạt động.

Mỗi Order dùng transaction với lock user → Order → Attempts và OCC/version hiện có. Worker đánh dấu `paymentExpiredAt`; chỉ chuyển CANCELLED/`PAYMENT_TIMEOUT` nếu gateway guards xác nhận không còn pending/UNKNOWN/REVIEW/unprocessed receipt. Không Attempt từng được phát hành là trường hợp có thể hủy an toàn. FAILED đã APPLIED thì stock/points đã release; worker chỉ hủy, không release lần hai. PENDING chưa có Attempt thì hoàn stock và RELEASE điểm trong cùng transaction.

AWAITING quá hạn được trình bày UNKNOWN, không tự gán FAILED. Giữ Order PENDING và reservations, tiếp tục nhận verified IPN. Verified success muộn vẫn settle PAID đúng một lần. Verified failure muộn áp dụng PAYMENT_FAILED trước, worker hủy ở lần quét kế tiếp. Lock chung chống race success/timeout; PAID không bị timeout hủy. Duplicate IPN/cancel giữ idempotency hiện có.

`PaymentReceiptWorker` chạy startup/mỗi5 giây, tiếp tục T2 của VERIFIED receipt chưa processed cho Order thuộc contract mới. T1 evidence còn trong DB sau crash; worker không gọi provider hoặc tự sinh evidence. REVIEW vẫn giữ để xử lý theo contract.

External QueryDr transport vẫn OFF. Không thể bảo đảm CANCELLED đúng mốc10 phút khi VNPAY chưa trả terminal evidence. UI hiển thị **Hết thời gian thanh toán — đang xác minh kết quả**, chặn checkout mới của cùng khách; không nhả Inventory/Loyalty hoặc tạo thanh toán thay thế. Đây là giới hạn có chủ đích để không tạo double charge.

## Session và bảo mật

- Access JWT vẫn HS256/3600 giây, chỉ ở memory, thêm `sid`. `JwtStrategy` đọc session còn hiệu lực/chưa revoked và đọc user/role từ DB cho protected requests. JWT legacy không sid còn được xác thực tới exp cũ để giữ tương thích rollout; chúng không tạo được session khôi phục.
- `AuthSession`: UUID, user FK, SHA256 token hash, previous-token hash cho phát hiện reuse, absolute expiry7 ngày, revokedAt/createdAt. Opaque token256 bit ở HttpOnly cookie `brewlite_session`; không lưu refresh token trong localStorage/sessionStorage/URL/log. Cookie không chứa password hoặc JWT.
- Login tạo session. `POST /auth/session` rotate token dưới row lock và cấp JWT mới/role mới, không kéo dài absolute expiry. Reuse previous token thu hồi family/session. `POST /auth/logout` thu hồi session và xóa cookie; JWT có sid mất quyền ngay sau logout. Logout một session không đăng xuất tài khoản đó trên các máy khác.
- Login/session/logout yêu cầu exact `Origin=FRONTEND_ORIGIN` và `X-BrewLite-CSRF: 1`; thiếu/sai403. Auth endpoints response private/no-store. Không chuyển protected business APIs sang cookie auth.
- Browser gọi `/api/auth/*` cùng origin Next với `credentials: same-origin`. Next rewrite tới `API_INTERNAL_BASE_URL` (default `http://127.0.0.1:3001`). Cookie host-only ở frontend host, Path=/api/auth, SameSite=Lax, HttpOnly, Secure trong production HTTPS. Không phụ thuộc third-party cookie giữa localhost và127.0.0.1. Public bearer APIs vẫn dùng `NEXT_PUBLIC_API_BASE_URL`/CORS.
- Root AuthSession hiển thị loading trong khi restore, giữ đường dẫn sau refresh, chỉ redirect protected route tới safe returnTo sau401. Lỗi mạng có Retry, không giả làm expired session. Refresh chủ động trước JWT expiry60 giây và khi focus. Web Locks serialize login/rotation/logout giữa tab; BroadcastChannel thông báo login/logout không mang token. Backend vẫn quyết định ownership/RBAC.

## Frontend và thao tác kiểm tra

`/cart` chỉ chứa Cart CRUD, tổng tạm tính, banner đơn cũ và link `/checkout`. `/checkout` kiểm tra active Order trước khi mount create flow. Nếu có A, dialog native có mã/trạng thái/countdown và link xem/tiếp tục A, quay lại Cart; B không bị xóa. URL `?orderId=A` mở snapshot/payment của A. Resume qua endpoint backend, không tạo giao dịch song song. Gateway checkout cập nhật trạng thái mỗi5 giây và khi người dùng yêu cầu.

Countdown dùng chênh lệch expiresAt/serverNow của response backend và monotonic elapsed trong trình duyệt; timer chỉ hiển thị. Reload đọc lại deadline cũ, không tạo thêm10 phút; backend enforce expiry dù không mở UI.

Kiểm tra trên giao diện sau khi nạp backend mới: login từng role rồi F5 trên trang hiện tại; đăng xuất; Customer thêm giỏ → `/checkout` tạo A → quay `/cart`, thêm/sửa B → `/checkout` thấy dialog A → tiếp tục A qua link. Không thực hiện VNPAY thật trong automated checks.

## Migration và rollout

Migration `20261022160000_checkout_expiration_sessions` chỉ ADD nullable columns/check/index vào orders và CREATE auth_sessions; FK RESTRICT. Không backfill/update/delete lịch sử, không reset/seed/restore Neon. Kiểm thử tạo database PostgreSQL local ngẫu nhiên rồi xóa đúng database do harness tạo; không chạy financial tests trên Neon.

Chạy migration bằng `npm run db:migrate:deploy`, generate client và build backend trước khi nạp code mới. Frontend build phải cấp đúng `NEXT_PUBLIC_API_BASE_URL` và `API_INTERNAL_BASE_URL`. Next dev tự nạp config; frontend production cần build lại. Không dừng/force-kill VNPAY còn cần callback. Launcher `dev:restart-backend` giữ ingress/ngrok; chỉ thực hiện khi profile cũ và source tương thích, không đổi provider/key/callback domain để rollout.

Focused evidence: `backend/test/database/checkout-lifecycle.spec.ts` (PostgreSQL cô lập), `frontend/test/auth-session.test.mjs`, auth/cart/checkout/gateway/history fixtures; Edge browser fixture trên port3100/3101, database local mới, kiểm tra reload3 roles và Cart/Checkout ở390/1440px. Chi tiết kết quả cuối cập nhật trong DEVELOPMENT_PLAN.

## Phạm vi file của amendment này

- Schema/migration: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261022160000_checkout_expiration_sessions/migration.sql`.
- Backend auth: `backend/src/auth/auth.controller.ts`, `auth.module.ts`, `session.service.ts`, `strategies/jwt.strategy.ts`; `backend/src/common/configure-app.ts`.
- Cart/Order: `backend/src/cart/cart.service.ts`; `backend/src/orders/order-policy.ts`, `order.controller.ts`, `order.module.ts`, `order.service.ts`, `payment-expiration.worker.ts`.
- Payment: `backend/src/payments/attempt.controller.ts`, `attempt.service.ts`, `payment-deadline.ts`, `payment-receipt.worker.ts`, `payment.module.ts`, `ipn.service.ts`, `payment.service.ts`, `zero-confirmation.service.ts`, `vnpay/initiation-config.ts`.
- Frontend config/routes: `frontend/next.config.ts`, `frontend/package.json`, `frontend/src/app/layout.tsx`, `globals.css`, `checkout/page.tsx`.
- Components: `frontend/src/components/auth-form.tsx`, `auth-nav.tsx`, `auth-session.tsx`, `operator-shell.tsx`, `cart-view.tsx`, `checkout-view.tsx`, `pending-order.tsx`, `payment-countdown.tsx`, `gateway-checkout.tsx`, `order-checkout.tsx`, `order-history-view.tsx`.
- Frontend libs/types: `frontend/src/lib/auth-store.ts`, `auth-session.ts`, `gateway-context.ts`, `api/auth.ts`, `api/gateway-payments.ts`, `api/orders.ts`; `frontend/src/types/order.ts`.
- Tests: `backend/test/database/checkout-lifecycle.spec.ts`; `frontend/test/auth-session.test.mjs`, `auth.test.mjs`, `gateway-payments.test.mjs`, `order-history.test.mjs`.
- Tài liệu: file này, README, REQUIREMENTS, DECISIONS, ARCHITECTURE, DATABASE_DESIGN, API_DESIGN, PROJECT_STRUCTURE, DEVELOPMENT_PLAN, TRACEABILITY_MATRIX. Không đưa thay đổi có sẵn trong worktree từ task trước vào danh sách amendment này.

Kết quả môi trường đang mở: Nest watcher đã nạp code mới, GET /health và /products200; Next proxy `/api/auth/session` và login sai trả401. Migration Neon đã deploy và fingerprint các bảng users/orders/order_items/payments/payment_attempts/loyalty_entries/products không đổi. Cần login một lần sau nâng cấp để tạo session cookie; không tự chuyển memory token cũ thành session. VNPAY live/PAID E2E không được thực hiện trong task này.
