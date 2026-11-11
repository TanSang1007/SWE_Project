# Docker Compose — demo local VNPAY Sandbox

Ba service frontend Next.js, backend NestJS và PostgreSQL18. Database mới nằm trong volume riêng, không dùng Neon. Đây là demo trên localhost, chưa phải triển khai Cloud/production. Backend chạy compiled code với NODE_ENV=development để giữ policy Sandbox; production vẫn bị chặn. Không đổi schema, API hoặc thuật toán thanh toán.

## Chọn cách chạy

Hướng dẫn chính cho thành viên dùng chung database Neon nằm trong README.md, mục 3–6. Chạy cả compose.yaml và compose.neon.yaml; không migrate, seed hoặc reset database Neon.

Các bước bên dưới dành riêng cho PostgreSQL local trong Docker. Database này độc lập với Neon, không có sẵn tài khoản và dữ liệu của nhóm. Callback owner kết nối Neon không xử lý được đơn chỉ tồn tại trong database local.

Khi chạy cùng Neon, thành viên có thể thử giao diện, đăng nhập và giỏ hàng với DOCKER_ACCEPT_PAYMENTS=false trong lúc owner chưa online. Chỉ mở thanh toán sau khi kiểm tra callback owner hoạt động.

## Chuẩn bị

Docker Desktop đang chạy Linux containers. Dùng Node24 trong image. Chạy các lệnh dưới đây tại thư mục gốc repo, PowerShell. Không chạy song song launcher local chiếm cổng3000/3001/3102. Nếu launcher cũ còn giao dịch chờ, xử lý theo NORMAL_SANDBOX_MODE; không kill/xóa runtime để lấy cổng.

```powershell
Copy-Item docker/config.example docker/local.env
```

Điền cấu hình trong docker/local.env: mật khẩu database chỉ chữ/số; JWT secret ngẫu nhiên tối thiểu32 byte; merchant/hash secret VNPAY được cấp; HTTPS callback origin đã đăng ký, không dấu / cuối. Không commit file này. Với chế độ local trong tài liệu này, giữ database Docker riêng. Nếu dùng Neon, làm theo README.md và compose.neon.yaml; không ghi trực tiếp URL chứa mật khẩu vào file Compose. Docker build context loại toàn bộ .env và cấu hình riêng; secrets chỉ truyền lúc chạy backend, không qua frontend/build args.

## Build, migration và khởi động

```powershell
docker compose --env-file docker/local.env config --quiet
docker compose --env-file docker/local.env build
docker compose --env-file docker/local.env up -d db
docker compose --env-file docker/local.env run --rm --no-deps backend npm run db:migrate:deploy --workspace backend
docker compose --env-file docker/local.env run --rm --no-deps backend npm run db:seed --workspace backend
docker compose --env-file docker/local.env up -d
docker compose --env-file docker/local.env ps
docker compose --env-file docker/local.env logs --tail 100 backend frontend
```

Chờ db healthy trước migration; nếu database chưa sẵn sàng, xem compose ps và chạy lại migration sau khi healthy. Seed chỉ chủ động chạy cho DB demo này; không seed tự động mỗi lần start. Seed cung cấp2 sản phẩm và topping/promotion mẫu, không tạo user. Mở http://localhost:3000 và đăng ký tài khoản mới. Chưa có dữ liệu57 món hay tài khoản Neon. Nếu muốn chuyển dữ liệu hiện có cần quy trình backup/restore riêng.

## Callback và thanh toán

Container backend chạy cả NestJS và callback ingress; ingress giữ allowlist GET IPN/Return và upstream loopback cũ. Host chỉ mở các cổng trên127.0.0.1; PostgreSQL không publish cổng. Frontend gọi API qua http://localhost:3002 trên máy người dùng; Docker chuyển cổng này vào backend:3001. Proxy đăng nhập gọi http://backend:3001 trong mạng Compose.

Với DB Docker riêng, callback phải tới backend Docker này. Máy owner đang trỏ Neon không thể xác nhận đơn chỉ tồn tại trong DB Docker. Không dùng đồng thời cùng một ngrok domain cho hai máy/tunnel. Giữ merchant/domain hiện có nếu còn giao dịch cần callback; cấu hình domain riêng được đăng ký cho môi trường Docker hoặc chuyển có kế hoạch sau khi môi trường cũ đã an toàn.

Giữ DOCKER_ACCEPT_PAYMENTS=false lúc đầu. Trên host đã cài/xác thực ngrok, mở terminal riêng (thay URL bằng DOCKER_CALLBACK_ORIGIN):

```powershell
ngrok http http://localhost:3102 --url https://your-registered-domain.ngrok-free.dev
curl.exe -i "https://your-registered-domain.ngrok-free.dev/payments/vnpay/ipn"
curl.exe -i "https://your-registered-domain.ngrok-free.dev/payments/vnpay/return"
```

IPN không chữ ký phải200 với RspCode99; Return phải303 về localhost:3000/payments/vnpay/result. Đây chỉ là transport smoke, không phải thanh toán thành công. Ngrok chỉ tunnel3102, không tunnel3001/Admin. Sau khi kiểm tra callback, đổi DOCKER_ACCEPT_PAYMENTS=true rồi:

```powershell
docker compose --env-file docker/local.env up -d backend
```

Kiểm tra giao dịch bằng thẻ TEST Sandbox: tạo đơn→VNPAY→IPN hợp lệ→PAID→xác nhận/lịch sử; failure giữ giỏ, replay không cộng điểm/trừ tồn lần hai. Cần chạy trên môi trường thật trước khi nghiệm thu.

## Dừng và lưu dữ liệu

Compose không có coordinator drain/safeToStop của npm launcher. Không dùng npm run dev:status/recover/stop để quản lý container. Trước bảo trì, đặt DOCKER_ACCEPT_PAYMENTS=false và recreate backend khi không có request đang chạy; giữ backend/ngrok hoạt động để nhận callback. Người vận hành phải kiểm tra Order/Attempt/receipt/reservation đã giải quyết, không dùng healthcheck làm bằng chứng an toàn dừng. Không down/recreate stack khi còn giao dịch chưa rõ kết quả.

Sau khi xử lý hết giao dịch và có thể dừng:

```powershell
docker compose --env-file docker/local.env down
```

Volume được giữ; tuyệt đối không thêm -v nếu muốn giữ dữ liệu. up -d dùng lại DB. Không có tự động startup callback readiness/monitor từ local launcher; người vận hành phải kiểm tra tunnel trước mở nhận mới. Mất tunnel không đồng nghĩa thất bại thanh toán; không force PAID/CANCELLED hoặc xóa reservations.

## Giới hạn kiểm chứng

Build backend và unit/HTTP có thể chạy ngoài Docker. Chỉ ghi Docker build/runtime/E2E PASS khi đã chạy Docker Engine và có merchant/callback hợp lệ. Docker health là process readiness, không chứng minh IPN public hay settlement. Cloud/public HTTPS, domain frontend khác localhost và production policy chưa thuộc bản Compose local này.

## Kiểm tra bản thay đổi

2026-11-10: backend build PASS;34 backend suites/918 unit-HTTP tests PASS (Jest resolver điều chỉnh riêng cho môi trường kiểm tra);18 runtime tests PASS; ESLint ba file backend thay đổi PASS; frontend production build với Webpack PASS sau khi cài CSS native đúng phiên bản; Compose YAML ba service và diff whitespace PASS. Windows lockfile thiếu Linux native packages: Docker frontend target cài đúng version theo lightningcss/@tailwindcss/oxide, hỗ trợ Linux x64/arm64 glibc. Không chạy Docker Engine, PostgreSQL integration hoặc merchant E2E; không tuyên bố image/runtime đạt.
