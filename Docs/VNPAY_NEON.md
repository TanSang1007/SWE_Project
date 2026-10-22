# VNPAY Sandbox với Neon dùng chung

Phạm vi owner giao trên branch `sang`: VNPAY development với Neon `brewlite_dev`, giữ schema, migration chain, money/state contracts và PostgreSQL local dự phòng. Truy vết B03/B19/P01 Normal Sandbox tại [kế hoạch](DEVELOPMENT_PLAN.md), [quyết định](DECISIONS.md) và [financial contract](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md).

## Vì sao trước đây bị chặn

`initiation-config.ts` chỉ nhận hostname loopback ở development; `dev-runtime-lib.cjs` chỉ cho Neon ở MOCK. Đây là giới hạn môi trường, tách khỏi HMAC, binding, authorization, locks, idempotency, SQL constraints và settlement. Cả hai hiện nhận database local hoặc pooled Neon `.neon.tech`, database `brewlite_dev`, TLS `require`/`verify-full`. NODE_ENV production vẫn bị từ chối; synthetic tests vẫn bắt buộc database local cô lập theo namespace test.

PrismaPg giữ pooled `DATABASE_URL`; Prisma 7 CLI giữ direct `DIRECT_URL`. Neon dùng [PgBouncer transaction pooling](https://neon.com/docs/connect/connection-pooling); row locks và `set_config(...,true)` của BrewLite nằm trong transaction, không phụ thuộc một session ngoài transaction. Không thêm session advisory lock, worker hoặc hạ tầng deployment.

20 SELECT tuần tự trên kết nối Neon thực đo 626 ms: tổng deadline local 400 ms không đủ cho nhiều round trip. Order/payment/Attempt/IPN/zero/Return dùng maxWait 2000 ms, timeout 5000 ms trên Neon; local vẫn 50/400 ms. SQL lock timeout 200 ms, statement timeout 300 ms và rollback giữ nguyên. Không tự retry transaction; timeout không được diễn giải là thanh toán thất bại. Không tuyên bố đạt NFR01 <500 ms trên môi trường mạng này.

Dependency reader của launcher đặt statement/lock timeout bằng `set_config(...,true)` sau `BEGIN ... READ ONLY`, thay vì đưa vào startup `options` mà Neon PgBouncer từ chối. Giới hạn truy vấn kiểm tra vẫn 5000/2000 ms và dữ liệu chỉ được đọc; status/stop hoạt động qua pooled connection.

## Một callback owner, nhiều thành viên

Đúng một máy được nhóm chỉ định làm **owner**, chạy backend và ngrok cho IPN/Return HTTPS đã đăng ký. Owner và tất cả member dùng cùng Neon, Merchant, HashSecret và callback profile. Giữ IPN URL hiện có, không đăng ký URL khác hoặc mở nhiều ngrok cho cùng Merchant. Trong lần cấu hình này, workspace `D:\SWE_Project` trên máy hiện tại được dùng làm owner; launcher cũ từ `D:\CNPM` đã safe-stop trước khi chuyển runtime, không sửa source `main`.

Trong private `.env.vnpay.local` của owner:

```dotenv
BREWLITE_CALLBACK_ROLE=owner
BREWLITE_NGROK_CONFIG=C:/path/to/private/ngrok.yml
```

Các máy còn lại đặt `BREWLITE_CALLBACK_ROLE=member`, cùng IPN/Return profile đã đăng ký; không cần ngrok config. Role là cấu hình máy một lần, không phải approval từng payment. Launcher member không khởi động ingress/ngrok, nhưng kiểm tra endpoint chung trước admission và khi monitor/recover; mất callback thì drain local. Unsigned HTTP smoke xác minh route/reachability, không chứng minh endpoint đang dùng cùng database/profile: owner phải cấu hình đúng `.env` theo phân công nhóm. Không tự failover sang callback khác.

JWT/role/ownership vẫn lấy từ user hiện tại và dữ liệu Neon. Attempt có Order/owner, txnRef unique và claim binding persisted, nên IPN owner xử lý được Attempt do member tạo mà không cần JWT của browser đó. Return đi qua callback owner rồi redirect về `http://localhost:3000/payments/vnpay/result` trên browser người trả tiền; trang result đọc trạng thái qua backend của thành viên. Return không settlement hoặc ghi verification receipt.

Owner giữ terminal/máy/mạng hoạt động trong lúc nhóm trả tiền. Cả owner/member giữ safe-stop bảo thủ: dependencies tính toàn database; pending/UNKNOWN/REVIEW/receipt/reservation/claim còn mở ngăn teardown. Dừng một máy không tự đóng admission các máy khác; nhóm ngừng tạo đơn mới trước khi owner drain/stop. Không force outcome hoặc đổi key/profile để dừng.

## Những bảo vệ giữ nguyên

- Sandbox2.1.0/HMAC-SHA512, merchant/signature/amount/reference/request binding; minimum 5000 VND cho positive total, zero explicit.
- Owner → Order → Attempt/receipt/claim → Product locks; transaction, OCC, unique claim/payment/effect và journal append-only.
- Durable T1 verification receipt, atomic T2 apply; verified IPN mới settlement. Duplicate IPN/payment không lặp Payment, stock hoặc Loyalty.
- Failed/cancelled payment hoàn reservation đúng cycle; success không trừ stock lần nữa, award/redemption/Cart commit cùng PAID. Hủy ở gateway không tự hủy Order.
- Pending/UNKNOWN/REVIEW giữ reservation và chặn retry/cancel không an toàn. Historical replay, per-Order URL TTL 900s và drain/recovery giữ nguyên.
- Production bị chặn; external QueryDr OFF; MOCK không đọc Merchant overlay. Không Gate A/B/C, session supervisor, quota Attempt hoặc expiry phiên 30 phút.

## Kiểm chứng tập trung

- Backend build/lint pass; 16 runtime owner/member/TLS/role/restart/drain/callback tests pass. 352 unit/HTTP assertions qua 10 suites đã pass (351 ban đầu và thêm một synthetic-gate regression; sandbox-gate chạy lại 33/33). 188 financial tests qua 5 suites trên database local cô lập pass.
- Unit/HTTP tests dùng mocks; financial tests dùng một database PostgreSQL local mới, tên test ngẫu nhiên, apply migrations chỉ bên trong schema test rồi dọn database test đó. Không chạy migration/seed/reset/restore trên Neon hoặc local `brewlite_dev`.
- Financial suites bao phủ initiation/replay/ownership, signed IPN success/failure/cancellation, duplicate/reused provider reference, UNKNOWN/REVIEW/rollback, inventory/redemption/Loyalty, Return read-only, drain và MOCK.
- NestJS VNPAY thực khởi động với Neon pooled; profile bootstrap pass, default drain, `/health` 200; ingress thật trả ACK99 cho unsigned IPN và 303 Return. External QueryDr vẫn disabled. 30 SELECT tuần tự trong Prisma transaction mất 809 ms và pass deadline Neon.
- Normal launcher thực trên máy owner đạt READY/admission mở, frontend/backend và HTTPS callback healthy. `dev:status` trả dependencies bằng 0; backend-only restart giữ PID ingress/ngrok/frontend; `dev:stop` trả `stopped:true`. Khởi động lại để bàn giao runtime đang chạy. Không có quota Attempt hoặc thời gian phiên.
- Smoke trên Neon ép `default_transaction_read_only=on`; đối chiếu toàn bảng/hashes/constraints/indexes/sequences/migrations trước và sau không đổi. Không tạo Order/PaymentAttempt hoặc gọi gateway. Actual payment bằng thẻ TEST do owner thực hiện; chưa coi unit/synthetic evidence là PAID E2E thật.

## File thay đổi trong task VNPAY + Neon

- Backend: `src/payments/vnpay/initiation-config.ts`, `src/database/pg-connection.ts`, `src/database/prisma.service.ts`; các transaction wrappers trong `src/orders/order.service.ts` và `src/payments/{attempt,ipn,payment,zero-confirmation,browser-return}.service.ts`; `test/sandbox-gate.spec.ts`.
- Launcher/tests: `scripts/dev-runtime-lib.cjs`, `scripts/dev-runtime.cjs`, `scripts/test/dev-runtime.test.cjs`; `.env.vnpay.local.example`.
- Hướng dẫn/traceability: README, ARCHITECTURE, DATABASE_DESIGN, DECISIONS, DEVELOPMENT_PLAN, NORMAL_SANDBOX_MODE, NEON_DEVELOPMENT, TRACEABILITY_MATRIX và tài liệu này. `.env.vnpay.local` private chứa role/ngrok config được ignore. `backend/prisma.config.ts` và `.env.example` giữ thay đổi DIRECT_URL từ task migration trước.

## Lệnh chạy và giao dịch TEST do owner thực hiện

Tại root workspace, sau khi điền private env theo [.env.vnpay.local.example](../.env.vnpay.local.example):

```powershell
npm run dev:vnpay
# Terminal khác
npm run dev:status
npm run dev:restart-backend
npm run dev:stop
```

Chỉ thanh toán khi status `READY`, `servicesHealthy=true`, backend provider `VNPAY_SANDBOX`, `acceptingNewPayments=true`, callback healthy. Giữ terminal owner mở. Thành viên không cần chạy seed/migration hoặc cấp approval từng lần trả tiền.

1. Mở `http://localhost:3000`, đăng nhập Customer, chọn sản phẩm/size/topping và kiểm tra tồn/giá.
2. Kiểm tra promotion/điểm/tổng cuối; dùng đơn positive total ít nhất 5000 VND để thử redirect VNPAY.
3. Nhấn **Thanh toán** một lần. Trên Sandbox chọn NCB và dùng **thẻ TEST** theo [hướng dẫn chính thức VNPAY](https://sandbox.vnpayment.vn/apis/docs/gioi-thieu/): số thẻ `9704198526191432198`, chủ thẻ `NGUYEN VAN A`, phát hành `07/15`, OTP `123456`. Không dùng thẻ thật.
4. Chờ Return/result rồi kiểm tra Order PAID/Payment SUCCEEDED từ backend và Inventory/Loyalty. Redirect thành công không thay cho verified IPN. Nếu còn UNKNOWN/REVIEW hoặc pending, giữ owner chạy, đọc trạng thái; không tạo giao dịch thay thế hoặc force PAID.
5. Có thể tạo và thanh toán các đơn độc lập tiếp theo bình thường. Để thử hủy, dùng thao tác Hủy trên Sandbox; kiểm tra kết quả persisted và unpaid cancel/retry theo capability của backend, không suy Order CANCELLED chỉ từ Return.

Chi tiết ngrok Free interstitial, vận hành và xử lý pending: [Normal Mode](NORMAL_SANDBOX_MODE.md).
