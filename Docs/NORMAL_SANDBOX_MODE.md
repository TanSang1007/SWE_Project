# BrewLite — Vận hành MOCK và Normal VNPAY Sandbox

Đây là hướng dẫn local hiện hành. Normal launcher trong `scripts/` không phụ thuộc Gate A/B/C, session ID hay helpers `.tmp`; không quota một Attempt/30 phút và không tự khởi tạo giao dịch. Per-user/per-Order locks, idempotency và financial guards vẫn giữ nguyên.

## 1. Setup và lệnh sử dụng

Làm [setup clone mới trong README](../README.md) trước: Node/npm đúng engines, `npm ci`, PostgreSQL local, root `.env`, JWT secret riêng, Prisma generate/migrations và catalog seed khi chủ động chuẩn bị DB demo mới. Launcher không migrate/seed/reset database.

Chạy từ npm workspace root trong PowerShell:

```powershell
npm run dev                 # MOCK, không Merchant/ngrok
npm run dev:vnpay           # Optional Local VNPAY Sandbox
# Terminal khác:
npm run dev:status          # PIDs sở hữu, health, provider/admission/callback/dependencies
npm run dev:restart-backend # Chỉ restart backend, giữ frontend/ingress/ngrok
npm run dev:drain           # Đóng nhận mới, giữ callback/profile
npm run dev:recover         # Thử khôi phục callback/readiness; mở lại khi healthy
npm run dev:stop            # Drain rồi chỉ dừng khi dependencies đã an toàn
```

Giữ terminal launcher mở. Không chạy thêm workspace servers trên 3000/3001; port bị chiếm hoặc launcher khác đang sống sẽ bị từ chối, không tự kill process lạ. Đổi source cần dừng an toàn rồi khởi động launcher lại: launcher build snapshot, không phải Nest watch. Frontend snapshot theo source hash ở ignored `.brewlite/builds/`; giữ nguyên `frontend/next-env.d.ts` nguồn.

## 2. Environment

| Nguồn | Cách dùng |
| --- | --- |
| Root `.env` | Backend, Prisma, CLI và base launcher; lấy từ [.env.example](../.env.example) |
| Root `.env.vnpay.local` | Overlay private chỉ đọc bởi `dev:vnpay`, lấy từ [example](../.env.vnpay.local.example); hoặc chọn qua `BREWLITE_VNPAY_ENV_FILE` |
| `frontend/.env.local` | Chỉ cần khi chạy workspace frontend độc lập; [example](../frontend/.env.local.example) chứa public API URL |

Launcher load root dotenv, environment của tiến trình rồi overlay VNPAY; đặt `NODE_ENV=development`, provider theo lệnh, backend/frontend loopback3001/3000 và origin/API `localhost`. Không viết lại root `.env`, không đọc overlay Merchant khi MOCK. MOCK outcome lấy `PAYMENT_MOCK_MODE=SUCCESS|FAILURE`; thay đổi xong restart backend.

### VNPAY optional

Cần Merchant được cấp quyền, `VNPAY_ENV=SANDBOX`, `VNPAY_VERSION=2.1.0`, TmnCode/HashSecret private, payment URL Sandbox chính thức và IPN/Return HTTPS cùng origin đã đăng ký. `VNPAY_IPN_URL` là profile/registration config, không gửi `vnp_IpnUrl` trong payment initiation. Không dùng credentials/domain người khác khi chưa được phép.

Cài ngrok và cấu hình token riêng, đặt `BREWLITE_NGROK_CONFIG` trỏ private agent config. `BREWLITE_NGROK_BIN` tùy chọn khi không có trong PATH. Không ghi token, key hay signed payment URL vào tài liệu/log. `.env.vnpay.local.example` chỉ có hostname/path placeholder.

`VNPAY_RESULT_URL` tùy chọn, nếu đặt phải đúng `http://localhost:3000/payments/vnpay/result`. `VNPAY_ATTEMPT_TTL_SECONDS=900` là hạn từng Attempt, không phải hạn ứng dụng. Sandbox hiện chỉ cho development/local DB; production guard vẫn từ chối. Không bật external QueryDr.

Không đổi key/callback/profile khi còn Attempt cần verification bằng profile cũ. Mỗi thành viên phải có callback được đăng ký tương ứng; launcher không đăng ký URL hoặc chọn Merchant thay người dùng.

## 3. Startup, admission và continuity

1. Build Prisma Client/backend/frontend từ source, không migration/seed/gateway initiation.
2. VNPAY backend bắt đầu `DRAIN_ONLY` (`VNPAY_ACCEPT_NEW_PAYMENTS=false`).
3. Ingress độc lập bind `127.0.0.1:3102`, upstream cố định `127.0.0.1:3001`.
4. Ngrok chỉ expose exact GET `/payments/vnpay/ipn` và `/payments/vnpay/return`; public smoke xác minh HTTPS, reject invalid-signature và allowlist/Return.
5. Backend-only restart mở admission khi checks PASS; không restart ingress/ngrok để làm bước này.

Mode và cờ enable/admission do launcher quản lý qua environment child process; cấu hình private hợp lệ vẫn bắt buộc. Admission theo config/provider/service health và explicit drain, không theo số giao dịch hay thời gian chạy. Monitor mỗi 30 giây; service/callback failure yêu cầu drain, giữ các handle callback độc lập. Recovery tự động khi lỗi tạm thời đã hết có thể mở lại; explicit operator drain chỉ mở qua `dev:recover` khi healthy. Lệnh recover cũng có thể khởi động lại callback process đã chết.

`dev:status` phải báo `READY`, `servicesHealthy=true`, `providerMode=VNPAY_SANDBOX`, `acceptingNewPayments=true` và callback healthy trước giao dịch mới. Public `GET /payments/config` không trả flag true khi đang mở: `{providerMode:"VNPAY_SANDBOX"}`; khi đóng mới thêm `acceptingNewPayments:false`. Không dùng riêng sự tồn tại của process để kết luận payment ready.

Local controller bind loopback/random port, token ngẫu nhiên ở ignored `.brewlite/runtime.json`; không public management API. Status không in token, DB URL, merchant key hay signed URL. Không sửa state file/PID thủ công để nhận ownership của listener lạ.

## 4. Shutdown và giao dịch chưa xử lý

`dev:stop` đóng admission bằng backend restart cùng profile rồi đọc dependencies read-only. Outstanding AWAITING/UNKNOWN/REVIEW, verified receipt chưa process, claim chưa hoàn tất hoặc reservation chưa giải quyết ngăn teardown: trạng thái `DRAINING_CALLBACKS_RETAINED`, command nonzero. Lỗi đọc DB cũng không cho cắt callback.

Giữ terminal, máy và mạng hoạt động; đọc Order/Attempt thật, chờ genuine callback/approved recovery. Chạy stop lại khi an toàn. Không force PAID/CANCELLED/FAILED, tự QueryDr, xóa reservation/history hay chuyển MOCK để mở khóa Checkout.

Launcher local không phải durable hosting: mất điện/mạng, đóng/kill parent hoặc OS vẫn có thể làm mất continuity. Dead/stale launcher không cho phép kill listener chưa xác minh ownership. Recovery pending cần giữ đúng profile và owner xử lý trạng thái thực tế.

## 5. Checkout, cancellation và retry

- Kiểm tra selected promotion, redeemedPoints và final server total trước payment. Latte S 40.000đ không promotion/points khác 30.000đ khi chủ động chọn BREW10K; đây là discount hợp lệ, không tự áp lại business rule.
- Double-click/transport replay dùng key và payload cũ; timeout không chứng minh thất bại. Không đổi key để tạo payment mới trong trạng thái chưa rõ.
- Verified failure chỉ retry cùng Order khi backend `canRetry`; PAID không được trả lần nữa. CANCELLED phải tạo Order/checkout intent/key mới khi backend/admission cho phép.
- Gateway cancellation code24 được map từ persisted VERIFIED/APPLIED evidence thành read-only `failureReason=CUSTOMER_CANCELLED`; không tin Return query. Result resolve authenticated status rồi về Home với thông báo/link xem đơn.
- Hủy payment không tự hủy Order: có thể còn PAYMENT_FAILED. Để sửa Cart/tạo đơn mới, chủ động hủy unpaid nếu backend `canCancel`, hoặc retry khi được phép. Return không settle/cancel.
- PENDING/UNKNOWN/REVIEW hiển thị chưa xác nhận và giữ guards/reservations.
- Admission CLOSED hiển thị “Thanh toán VNPAY hiện đang tạm ngừng nhận giao dịch mới.” kèm refresh; frontend không override. Normal completion không tự đóng admission.

## 6. Ngrok Free và Shared Staging

`ERR_NGROK_6024`/browser interstitial nằm tại ngrok trước khi Return tới ứng dụng. IPN/API probes có thể hoạt động trong khi browser gặp cảnh báo. Chỉ dùng hành động truy cập bình thường với domain đáng tin; không giả User-Agent, bypass header hoặc che lỗi. Xem [giới hạn Free chính thức](https://ngrok.com/docs/pricing-limits/free-plan-limits).

Muốn loại bỏ trang trung gian cần HTTPS callback không chèn cảnh báo: tunnel có cấu hình/gói phù hợp hoặc Shared Staging chạy liên tục với DNS/TLS/backend/DB/secrets riêng. Cần đăng ký URL Merchant tương ứng và review frontend origin/Return allowlist/CORS cùng guard development-only. Không tái dùng topology `localhost:3000` cho khách từ xa. Đây là task deployment riêng, chưa triển khai và không tự đổi IPN đã đăng ký.

## 7. Tài khoản demo và thao tác thanh toán

Seed không tạo User. Customer đăng ký/đăng nhập qua UI. Admin/Staff dùng CLI create-only được kiểm soát, chỉ DB local tên `_dev`/`_test`, `NODE_ENV=development`, terminal interactive:

```powershell
$env:ALLOW_OPERATOR_PROVISIONING = 'true'
try {
    npm run provision:operator --workspace backend -- --role ADMIN
} finally {
    Remove-Item Env:ALLOW_OPERATOR_PROVISIONING
}
```

Đổi `ADMIN` thành `STAFF` nếu cần; CLI hỏi email/password, không đưa password vào argv/Git. Không chạy provisioning trong quá trình kiểm tra tài liệu.

Khi status READY: mở http://localhost:3000 → đăng nhập → chuẩn bị Cart → xác nhận tổng cuối → nhấn thanh toán một lần → thẻ TEST VNPAY → đối chiếu Order/Payment/real verified IPN. Chỉ PAID từ backend mới xác nhận thành công. Những lần mua độc lập tiếp theo không cần mở Gate lại; unresolved Order cũ vẫn chịu financial guards.

[API](API_DESIGN.md) · [Financial contract](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md) · [Attribution](P01B2A_LOYALTY_ATTRIBUTION_AMENDMENT.md) · [README dự án](../README.md).
