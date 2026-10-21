# BrewLite — Quản lý và đặt hàng cà phê

## 1. Giới thiệu

BrewLite hỗ trợ khách chọn đồ uống, tùy chỉnh size/topping, đặt hàng, thanh toán và theo dõi đơn lấy tại quầy. Nhân viên xử lý hàng đợi pha chế; quản trị viên quản lý menu, tồn kho và đơn hàng.

Nền tảng gồm frontend Next.js, backend NestJS và PostgreSQL. Thanh toán mặc định là MOCK; VNPAY Sandbox là tùy chọn kiểm thử, chưa phải tích hợp thanh toán production.

## 2. Thành viên nhóm


| STT | Họ tên | Vai trò | Công việc phụ trách |
| --- | --- | --- | --- |
| — | Chờ nhóm bổ sung | Chờ xác nhận | Chờ xác nhận |

## 3. Công nghệ sử dụng

Phiên bản đang pin trong các `package.json` và `package-lock.json`:

| Thành phần | Công nghệ |
| --- | --- |
| Frontend | Next.js **16.3.8**, React **19.3.0**, TypeScript **5.9.3** |
| UI/state | Tailwind CSS **4.3.3**, Zustand **5.0.15**, Fetch API |
| Backend | NestJS **11.2.7**, TypeScript **5.9.3**, class-validator **0.14.4** |
| Authentication | JWT (`@nestjs/jwt` **11.0.2**), Passport, bcrypt **6.0.0** |
| Persistence | Prisma **7.10.0**, PostgreSQL adapter, `pg` **8.23.1** (driver) |
| Database | PostgreSQL **18.x**, theo baseline thiết kế |
| Payment | MOCK SUCCESS/FAILURE; VNPAY Sandbox 2.1.0, HMAC-SHA512 |
| Tests | Jest/Supertest, Node.js test runner và browser harness có sẵn |

## 4. Các chức năng chính

**Customer:** đăng ký/đăng nhập; xem menu/chi tiết; chọn size/topping; giỏ hàng PostgreSQL theo tài khoản; checkout với giá server, mã khuyến mãi và điểm; thanh toán; xác nhận/lịch sử đơn; số dư và lịch sử Loyalty.

**Staff:** xem hàng đợi được phép, chuyển `PAID → PREPARING → READY → COMPLETED`.

**Admin:** quản lý sản phẩm, size/topping và liên kết tùy chọn; điều chỉnh tồn có version/idempotency; xem đơn và hủy PAID theo quyền/contract. Hủy nội bộ không đồng nghĩa hoàn tiền gateway.

Chưa có quản trị Campaign/Promotion, báo cáo doanh thu hay quản lý khách hàng hoàn chỉnh. Phân biệt yêu cầu PDF và extension được duyệt tại [REQUIREMENTS](Docs/REQUIREMENTS.md).

## 5. Cấu trúc thư mục

```text
SWE_Project/
├── frontend/                  # Next.js App Router, UI và test
├── backend/
│   ├── src/                   # NestJS modules và callback ingress
│   ├── prisma/                # schema.prisma, migrations/, seed.cjs
│   ├── scripts/               # Provision operator, reconciliation, auth config
│   └── test/                  # Unit/HTTP và database integration tests
├── scripts/                   # Launcher MOCK/VNPAY và lifecycle tests
├── ops/                       # Ví dụ ngrok callback-only
├── Docs/                      # Yêu cầu, thiết kế, contract, hướng dẫn
├── .env.example               # Cấu hình local mẫu
├── .env.vnpay.local.example    # Overlay Sandbox riêng, tùy chọn
├── package.json               # npm workspace root
└── package-lock.json
```

Chi tiết: [PROJECT_STRUCTURE](Docs/PROJECT_STRUCTURE.md).

## 6. Yêu cầu hệ thống

- Node.js **>=24.11 và <25**; npm **>=11 và <12** (root `engines`).
- PostgreSQL **18.x** chạy riêng; Git **2.x**.
- Windows PowerShell; ngrok chỉ cần cho Local VNPAY Sandbox.

Chạy lệnh tại root chứa `package.json`, không cài dependencies riêng từng workspace. Dùng `npm.cmd` thay `npm` nếu PowerShell chặn `npm.ps1`.

## 7. Clone và cài đặt

Repository đích có commit riêng. Hướng dẫn này áp dụng **sau khi owner tích hợp source BrewLite**; nếu clone chỉ thấy README `SWE_Project`, source chưa được bàn giao. Source BrewLite được nhập từ snapshot đã được owner duyệt.

```powershell
git clone https://github.com/TanSang1007/SWE_Project.git
Set-Location SWE_Project
npm ci
Copy-Item .env.example .env
node backend/scripts/configure-auth-env.cjs
```

Helper auth tạo JWT secret ngẫu nhiên khi còn placeholder, không in secret. Các lệnh copy dành cho clone mới; không ghi đè `.env` đang dùng.

Khởi động PostgreSQL. Ví dụ tạo DB mới với tài khoản PostgreSQL của bạn (`createdb` cần có trong PATH):

```powershell
createdb -h localhost -U postgres -W brewlite_dev
```

Chỉnh `DATABASE_URL` trong `.env` theo user/password thực và DB vừa tạo. URL-encode phần password nếu có ký tự đặc biệt. Giữ `NODE_ENV=development` và `PAYMENT_PROVIDER_MODE=MOCK`.

```powershell
npm run db:validate
npm run db:generate
npm run db:migrate:deploy
# Chỉ seed khi chủ động chuẩn bị DB development/demo mới:
npm run db:seed
npm run dev
```

Migration áp dụng schema hiện có; không dùng reset để setup. Seed tạo catalog/khuyến mãi mẫu, **không tạo tài khoản/giao dịch**; seed có thể cập nhật catalog nên không chạy tùy tiện trên DB đang sử dụng. Đăng ký Customer qua UI. Provision Admin/Staff là bước riêng: [hướng dẫn vận hành](Docs/NORMAL_SANDBOX_MODE.md).

Chờ `READY`, mở **http://localhost:3000**. Backend `http://localhost:3001`, health `http://localhost:3001/health`. Giữ terminal launcher mở; không chạy thêm workspace server trên cùng port.

## 8. Environment Configuration

| File | Nơi đọc / mục đích |
| --- | --- |
| Root `.env` từ [.env.example](.env.example) | NestJS, Prisma config, CLI và launcher local |
| Root `.env.vnpay.local` từ [example](.env.vnpay.local.example) | Overlay private chỉ cho `dev:vnpay`; MOCK không đọc |
| `frontend/.env.local` từ [example](frontend/.env.local.example) | Frontend độc lập; launcher tự cấp API URL local |

Backend không yêu cầu `backend/.env`. Không đặt secrets trong `NEXT_PUBLIC_*`. File private được ignore, không đưa lên GitHub.

| Biến | Ý nghĩa / cấu hình local |
| --- | --- |
| `NODE_ENV` | `development`; Sandbox hiện từ chối production |
| `PORT` | Backend `3001`; frontend `3000` |
| `FRONTEND_ORIGIN` | `http://localhost:3000`, đúng browser origin cho CORS/Return |
| `DATABASE_URL` | Placeholder: `postgresql://postgres:YOUR_LOCAL_PASSWORD@localhost:5432/brewlite_dev?schema=public` |
| `JWT_SECRET` | Random tối thiểu 32 byte; dùng helper ở bước cài đặt |
| `JWT_EXPIRES_IN` | `3600` giây, policy một giờ |
| `PAYMENT_PROVIDER_MODE` | Mặc định `MOCK`; tùy chọn `VNPAY_SANDBOX` |
| `PAYMENT_MOCK_MODE` | `SUCCESS` hoặc `FAILURE`, server quyết định; đổi xong restart backend |
| `VNPAY_SANDBOX_ENABLED` | Mặc định `false`; Sandbox trực tiếp cần `true` |
| `VNPAY_ACCEPT_NEW_PAYMENTS` | `false`: DRAIN_ONLY; `true`: nhận mới khi config/health cho phép |

Launcher chọn provider theo lệnh, cố định port/origin local và quản lý hai cờ Sandbox: bắt đầu DRAIN_ONLY, mở admission sau callback checks. Sửa file không phải hot-toggle và không bỏ qua readiness.

## 9. Payment Setup — MOCK

Để `PAYMENT_PROVIDER_MODE=MOCK`, chọn `PAYMENT_MOCK_MODE=SUCCESS` hoặc `FAILURE` trong root `.env`:

```powershell
npm run dev
# Terminal khác:
npm run dev:status
# Sau khi đổi PAYMENT_MOCK_MODE:
npm run dev:restart-backend
```

Không cần Merchant, ngrok, public callback hay credentials owner. Ví/Thẻ là giả lập; client không gửi kết quả thành công. Đọc trạng thái đơn để đối chiếu kết quả server.

## 10. Payment Setup — VNPAY Sandbox (tùy chọn)

### A. Merchant Sandbox

Cần Merchant/TmnCode/HashSecret hợp lệ được cấp quyền sử dụng. Không chia sẻ HashSecret qua GitHub và không mặc nhiên dùng Merchant/domain owner. Chỉ dùng **thẻ TEST do VNPAY cung cấp**, không dùng thẻ thật.

### B. Private environment

```powershell
Copy-Item .env.vnpay.local.example .env.vnpay.local
```

Điền riêng các giá trị sau; ví dụ đều là placeholder:

```dotenv
PAYMENT_PROVIDER_MODE=VNPAY_SANDBOX
VNPAY_SANDBOX_ENABLED=true
VNPAY_ACCEPT_NEW_PAYMENTS=true
VNPAY_ENV=SANDBOX
VNPAY_VERSION=2.1.0
VNPAY_TMN_CODE=YOURCODE
VNPAY_HASH_SECRET=replace_with_merchant_issued_secret
VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNPAY_RETURN_URL=https://your-registered-host.example/payments/vnpay/return
VNPAY_IPN_URL=https://your-registered-host.example/payments/vnpay/ipn
VNPAY_RESULT_URL=http://localhost:3000/payments/vnpay/result
BREWLITE_NGROK_CONFIG=C:/path/to/private/ngrok.yml
```

Ba cờ đầu diễn tả Sandbox sẵn sàng; launcher vẫn tự chuyển DRAIN_ONLY → nhận mới sau checks. `VNPAY_RESULT_URL` tùy chọn nhưng nếu đặt phải đúng URL trên. `VNPAY_ATTEMPT_TTL_SECONDS` hỗ trợ `900` theo contract: hạn từng Attempt, không phải hạn chạy ứng dụng.

`VNPAY_IPN_URL` dùng kiểm tra profile/đăng ký callback, **không gửi dưới dạng `vnp_IpnUrl` trong payment initiation**. `BREWLITE_VNPAY_ENV_FILE` chọn overlay riêng; `BREWLITE_NGROK_BIN` chọn executable khi ngrok không trong PATH. Token ngrok chỉ nằm trong private config.

### C. Public callback

Cài và xác thực ngrok riêng. IPN/Return phải là cặp HTTPS cùng origin, đúng domain/path VNPAY đăng ký cho Merchant môi trường đó. Launcher không đăng ký hay thay URL.

Chỉ tunnel ingress `127.0.0.1:3102`, với hai GET routes `/payments/vnpay/ipn` và `/payments/vnpay/return`. Không expose toàn bộ backend, Admin hay PostgreSQL. Không đổi key/profile khi Attempt cũ còn cần callback.

### D. Khởi động Normal Sandbox Mode

```powershell
npm run dev:vnpay
# Terminal khác:
npm run dev:status
npm run dev:restart-backend
npm run dev:stop
```

Nếu MOCK đang chạy, dùng `dev:stop`, chờ dừng an toàn rồi chọn mode mới. Launcher từ chối port/listener lạ, không kill process không thuộc nó. `restart-backend` giữ ingress/ngrok. Không cần Gate A/B/C, không giới hạn một Attempt/30 phút; admission phụ thuộc cấu hình, health và drain.

`dev:stop` đóng admission trước. Nếu có pending/UNKNOWN/REVIEW, receipt hoặc reservation chưa xử lý, lệnh **từ chối cắt callback**; giữ terminal/mạng và xử lý theo contract. Xem [NORMAL_SANDBOX_MODE](Docs/NORMAL_SANDBOX_MODE.md) cho `dev:drain`/`dev:recover`.

### E. Kiểm thử trên giao diện

1. Chỉ bắt đầu khi status báo `READY`, provider `VNPAY_SANDBOX`, `acceptingNewPayments=true`, callback healthy.
2. Đăng nhập, thêm món; kiểm tra size/topping, promotion, điểm và **tổng cuối cùng** ở Checkout trong trang Giỏ hàng.
3. Nhấn thanh toán một lần; hoàn tất trên Sandbox bằng thẻ TEST.
4. Xem result/lịch sử. **Verified IPN** mới settlement; Return chỉ điều hướng/đọc trạng thái.
5. Hủy được xác minh đưa về Home với thông báo/link xem đơn. Nếu còn `PAYMENT_FAILED`, chỉ retry khi backend cho phép hoặc hủy unpaid hợp lệ để tạo đơn mới. `CANCELLED` cần checkout intent/key mới.

Pending/UNKNOWN/REVIEW không được force PAID hoặc tạo giao dịch thay thế. External QueryDr mặc định OFF. Nhận callback không đồng nghĩa SUCCESS E2E đã nghiệm thu.

### F. Troubleshooting

| Hiện tượng | Kiểm tra an toàn |
| --- | --- |
| `EADDRINUSE` 3000/3001 | `dev:status`; không chạy thêm server; xác minh ownership trước thao tác |
| CORS | Dùng `localhost:3000` nhất quán; `127.0.0.1` là origin khác |
| Thiếu DATABASE_URL/JWT_SECRET | Kiểm tra root `.env`, chạy helper auth nếu còn placeholder |
| Thiếu Prisma Client | `npm run db:generate` tại root |
| VNPAY chưa bật/admission CLOSED | Đọc status/config; UI giải thích tạm ngừng nhận giao dịch mới |
| Callback/ngrok không reachable | Kiểm tra mạng, profile/domain đăng ký và ngrok config; giữ continuity cho Attempt mở |
| Ngrok Free (`ERR_NGROK_6024`) | Cảnh báo nằm trước ứng dụng; frontend/Return không sửa được, không bypass headers/User-Agent |
| Đơn chờ xử lý | Xem đơn/status; không đổi key để trả trùng hoặc force trạng thái |

Muốn bỏ hẳn interstitial cần HTTPS callback không chèn cảnh báo, ví dụ tunnel phù hợp hoặc Shared Staging. Staging cần backend HTTPS, DNS/TLS, database/secrets riêng và callback đăng ký tương ứng. Guard hiện giới hạn local/development nên cần task deployment riêng; chưa deploy staging hay đổi IPN trong lần bàn giao này.

## 11. API và Database

API gồm catalog, auth, cart, orders, payments, loyalty và routes Admin/Staff được phân quyền. Database nhóm catalog/options, user/cart, order snapshots, idempotency, payment/attempt/verification, loyalty award/journal.

Chi tiết: [API_DESIGN](Docs/API_DESIGN.md), [DATABASE_DESIGN](Docs/DATABASE_DESIGN.md). Frontend không phải nguồn quyết định settlement.

## 12. Tài liệu dự án

| Tài liệu | Nội dung |
| --- | --- |
| [PDF gốc](Docs/BrewLite-CongNghePhanMem.pdf) / [REQUIREMENTS](Docs/REQUIREMENTS.md) | Baseline và extension được duyệt |
| [ARCHITECTURE](Docs/ARCHITECTURE.md) | Modules, transactions, callback boundary |
| [PROJECT_STRUCTURE](Docs/PROJECT_STRUCTURE.md) | Cây thư mục thực tế |
| [API_DESIGN](Docs/API_DESIGN.md) / [DATABASE_DESIGN](Docs/DATABASE_DESIGN.md) | API, schema và invariants |
| [DECISIONS](Docs/DECISIONS.md) / [DESIGN_REVIEW](Docs/DESIGN_REVIEW.md) | Quyết định và giới hạn nghiệm thu |
| [DEVELOPMENT_PLAN](Docs/DEVELOPMENT_PLAN.md) / [TRACEABILITY_MATRIX](Docs/TRACEABILITY_MATRIX.md) | Backlog, requirement/source/tests |
| [NORMAL_SANDBOX_MODE](Docs/NORMAL_SANDBOX_MODE.md) | Setup, lifecycle, shutdown/recovery |
| [P00 payment contract](Docs/P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md) | Frozen VNPAY contract |
| [Loyalty contract](Docs/L00_LOYALTY_REDEMPTION_CONTRACT.md) | Redeem/reserve/settle/release, debt |

Các contract B/A/P bổ sung thiết kế. Báo cáo phiên cũ được giữ do script phụ thuộc không phải hướng dẫn vận hành hiện hành.

## 13. Kiểm thử

```powershell
npm test                                      # Backend unit/HTTP tests
npm run test --workspace frontend              # Frontend fixture/unit tests
npm run test:runtime                           # Launcher lifecycle fixtures
npm run typecheck --workspace frontend
node node_modules/typescript/bin/tsc --noEmit --project backend/tsconfig.json
npm run lint
npm run build
```

Database integration: `npm run test:database`. Suite tạo schema test riêng, cần PostgreSQL local, cấu hình development/test hợp lệ và DB tên kết thúc `_dev` hoặc `_test`. Đọc [database test config](backend/jest.database.config.cjs) và [foundation tests](backend/test/database/foundation.spec.ts) trước khi chạy; đây không phải kiểm tra tài liệu read-only. Generate Prisma Client trước typecheck backend.

Browser harness/reconciliation có điều kiện riêng, không chạy tùy tiện trên database demo. Con số PASS lịch sử không bảo đảm kết quả trên máy mới. Không cần chạy migrations, seed hay gateway transactions để kiểm tra tài liệu.

## 14. Git Workflow / Đóng góp

Sau khi repository đã tích hợp và đồng bộ:

```powershell
git switch -c docs/ten-cong-viec
# Kiểm tra diff và chọn đúng từng path để stage
git add README.md
git diff --cached
git commit -m "docs: mo ta thay doi"
git push -u origin docs/ten-cong-viec
```

Tạo Pull Request, review trước merge `main`. Không commit secrets, dump, log/generated artifacts. Không `git add .` khi worktree còn thay đổi chưa phân loại. Lần chuẩn bị này không commit/push; owner quyết định tích hợp hai lịch sử Git trước.

## 15. Trạng thái dự án

Source có Customer/MOCK, Admin/Staff, Loyalty redemption, VNPAY verified IPN/Return read-only, cancel/recovery UX và Normal launcher. Không coi successful PAID Sandbox E2E đã nghiệm thu chỉ từ tests/giao dịch hủy.

Docker Compose theo PDF chưa có trong repository; browser matrix, hiệu năng và clean-clone đầy đủ cần bằng chứng riêng. Shared Staging/production chưa triển khai. Việc còn lại: [DEVELOPMENT_PLAN](Docs/DEVELOPMENT_PLAN.md).
