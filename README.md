# BrewLite — Quản lý và đặt hàng cà phê

## 1. Giới thiệu

BrewLite hỗ trợ khách chọn đồ uống, tùy chỉnh size/topping, đặt hàng, thanh toán và theo dõi đơn lấy tại quầy. Nhân viên xử lý hàng đợi pha chế; quản trị viên quản lý menu, tồn kho và đơn hàng.

Nền tảng gồm frontend Next.js, backend NestJS và PostgreSQL. Hệ thống sử dụng duy nhất VNPAY Sandbox làm phương thức thanh toán trực tuyến (kèm xác nhận nội bộ cho đơn 0 VND); hình thức Mock Payment đã được loại bỏ hoàn toàn.

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
| Payment | VNPAY Sandbox 2.1.0 (HMAC-SHA512) và INTERNAL_ZERO cho đơn 0 VND |
| Tests | Jest/Supertest, Node.js test runner và browser harness có sẵn |

## 4. Các chức năng chính

**Hủy và theo dõi đơn O01 (2026-11-15):** khách có thể hủy trong 120 giây từ khi backend xác nhận thanh toán. Nhân viên chỉ bắt đầu pha sau hạn; hết giờ vẫn chờ nhân viên thao tác. Chi tiết đơn tự cập nhật tiến độ, lịch sử, yêu cầu hỗ trợ và trạng thái hoàn tiền riêng. Admin duyệt và ghi nhận hoàn tiền bằng mã giao dịch cùng bằng chứng đã kiểm tra; hệ thống chưa tự chuyển tiền hoặc gọi API hoàn tiền VNPAY. Hủy trước pha giải phóng nguyên liệu chưa dùng đúng một lần; nguyên liệu đã dùng không tự hoàn kho. [Contract và kiểm chứng](Docs/O01_CANCEL_TRACKING.md).

Migration O01 đã áp dụng trên database development dùng chung và giữ dữ liệu cũ; thành viên không cần chạy lại migration/reset/seed. Khi frontend/backend đang chạy, tải lại trang để nhận phần theo dõi mới.

**Quy định tồn kho/trạng thái món I08 (2026-11-13):** chỉ bán tại chỗ. Kiểm kê nguyên liệu theo ngày có Nháp/Chờ duyệt/Đã duyệt/Từ chối, tỷ lệ theo tiêu hao và ngưỡng từng nguyên liệu do Admin cấu hình. Duyệt đối chiếu các giao dịch sau mốc kiểm kê rồi chỉ điều chỉnh chênh lệch, giữ lượng nhập/tiêu hao/phần đã giữ. Không tính chênh lệch đá/vật dụng. Nước lọc giữ trong công thức tham khảo nhưng không nhập/giữ/trừ tồn hoặc làm món hết hàng; danh mục đang quản lý còn12 nguyên liệu/6 vật dụng, giữ dữ liệu nước cũ. Bỏ qua cảnh báo theo trung bình/ngày dự phòng; giữ ngưỡng tồn hiện hành. Admin/Staff thấy cảnh báo món theo từng size. Các checkpoint I01–I07 dưới đây được đọc cùng [contract I08](Docs/I08_INVENTORY_CONTROL.md).

**Công thức theo size (I07, hiện hành):**7 món dùng đúng định lượng S/M/L và topping trong3 file công thức; Cold Brew luôn có syrup theo lựa chọn người dùng. Danh mục mới gồm13 nguyên liệu/sáu vật dụng, khởi tạo tồn0 và giữ riêng toàn bộ kho/lịch sử cũ. Khi tạo đơn, giữ đúng nguyên liệu theo size×số lượng; khi Staff bắt đầu pha, ghi tiêu hao một lần. Hủy hoặc thanh toán thất bại chỉ giải phóng phần chưa dùng. Menu khóa riêng size/topping không đủ và hiển thị sắp hết khi còn1–10 ly. Kho hiển thị tồn thực tế/có thể bán, tự đọc lại20s/focus; cột “Đã giữ” được bỏ theo yêu cầu ngày2026-11-15, hệ thống vẫn giữ nguyên liệu khi tạo đơn. Cần nhập lượng thực tế vào danh mục mới để mở bán, không tự quy đổi kho cũ. [Contract, migration và kiểm chứng](Docs/I07_SIZE_RECIPE_CONSUMPTION.md). Các mô tả I01–I06 bên dưới là lịch sử; phần availability/danh mục/no-consumption đã được I07 thay thế.

**Customer:** đăng ký/đăng nhập; xem menu/chi tiết; chọn size/topping; giỏ hàng PostgreSQL theo tài khoản; checkout với giá server, mã khuyến mãi và điểm; thanh toán; xác nhận/lịch sử đơn; số dư và lịch sử Loyalty.

**Staff:** xem hàng đợi được phép, chuyển `PAID → PREPARING → READY → COMPLETED`.

**Danh mục nhập hàng (I03):** quản lý trong một file [ingredient-catalog.ts](backend/src/ingredients/ingredient-catalog.ts): thêm dòng để bổ sung mặt hàng, bỏ dòng để ẩn khỏi kho/phiếu mới, sửa `label` để đổi tên hiển thị mà giữ tồn cũ. Backend cần nhận bản sửa trước khi Admin mở/tải lại kho để khởi tạo phần thiếu với tồn0; không xóa dữ liệu hay lịch sử. Danh mục hiện hành có5 vật dụng và9 nguyên liệu; bao/chai dùng số nguyên; ngưỡng nguyên liệu hiện hành theo I06 bên dưới. [Danh sách mới](Docs/I04_INVENTORY_CATALOG_REFRESH.md). [Cách chỉnh file, chạy lại backend và kiểm chứng](Docs/I03_RECEIVING_CATALOG.md).

**Ngưỡng nguyên liệu (I06):** dùng bảng riêng theo từng mặt hàng, cảnh báo khi tồn dương và nhỏ hơn hoặc bằng ngưỡng; giữ nguyên tên/đơn vị/lượng tồn. Caramel1 chai, Đá1 bao theo quy đổi đã xác nhận. [Đủ9 ngưỡng hiện hành](Docs/I06_INGREDIENT_WARNING_THRESHOLDS.md). Các ngưỡng theo đơn vị ở I01/I02 bên dưới là baseline trước amendment này.

**Tồn kho và nhập hàng (I01/I02):** Admin có sáu mục Tổng quan, Đơn hàng, Sản phẩm, Topping, Tồn kho, Nhập hàng. `/admin/inventory` chia Quản lý vật dụng (cái) và Quản lý nguyên liệu (lít/kg/chai/bao); `/admin/receipts` có Vật dụng, Nguyên liệu, Lịch sử nhập hàng. Vật dụng cảnh báo dưới10 cái;9 nguyên liệu áp dụng ngưỡng riêng và dấu≤ theo I06. Tồn0 là hết hàng. Thêm mới, nhập kho và lịch sử dùng database thật. Staff gửi kiểm kê tại `/operator/ingredients`; chỉ Admin duyệt/từ chối/yêu cầu kiểm kê lại, không ghi đè phiếu cũ khi tồn đã thay đổi. Tồn sản phẩm bán ra vẫn ở Sản phẩm → Tồn sản phẩm (`/admin/products/inventory`). Chưa trừ theo công thức pha chế. [Contract I01](Docs/I01_INGREDIENT_INVENTORY_CONTRACT.md), [amendment I02](Docs/I02_INVENTORY_CATEGORIES.md).

Database I01 đã được cập nhật trên Neon development. Admin mở/tải lại kho để bổ sung các mặt hàng có trong file danh mục với tồn0; giao diện có thống kê và timeout12 giây, lỗi lịch sử không chặn danh sách. [Hướng dẫn migration, danh sách file và kết quả kiểm thử I01 ban đầu](Docs/I01_INGREDIENT_INVENTORY_IMPLEMENTATION.md).

Lỗi kho/nhập hàng localhost do ID TEXT/UUID đã được sửa trong IngredientService; không còn quy mọi lỗi SQL thành “cập nhật đồng thời”. Đã xác nhận hai trang tải đủ14 mặt hàng theo nhóm5 vật dụng/9 nguyên liệu và thống kê sau F5; mặt hàng mới có tồn0, cần nhập hàng theo số lượng thực tế. [Phạm vi sửa và bằng chứng](Docs/LOCAL_INVENTORY_REPAIR.md).

**Còn/hết món theo nguyên liệu (I05):**7 món dùng danh sách nguyên liệu do người dùng chỉ định; mọi nguyên liệu còn lớn hơn0 thì còn món, thiếu/hết thì hết món. Áp dụng Admin, menu và đặt hàng; không dùng số tồn món nhập tay cho đơn mới và chưa tự trừ nguyên liệu vì chưa có định lượng. Nhập hàng/kiểm kê nguyên liệu rồi tải lại để cập nhật. Đơn cũ giữ hoàn tồn đúng theo snapshot. [Công thức và cách vận hành](Docs/I05_PRODUCT_INGREDIENT_AVAILABILITY.md).

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
├── scripts/                   # Launcher VNPAY Sandbox và lifecycle tests
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
- Git **2.x**; kết nối Internet tới Neon PostgreSQL **18** dùng chung. Không cần cài PostgreSQL local để chạy ứng dụng.
- Windows PowerShell; ngrok chỉ cần cho Local VNPAY Sandbox.

Chạy lệnh tại root chứa `package.json`, không cài dependencies riêng từng workspace. Dùng `npm.cmd` thay `npm` nếu PowerShell chặn `npm.ps1`.

## 7. Clone và cài đặt

Chạy các lệnh sau trong PowerShell:

```powershell
git clone https://github.com/TanSang1007/SWE_Project.git
cd SWE_Project
npm ci
Copy-Item .env.example .env
```

Root `package.json` có `allowScripts` pin đúng phiên bản đã review cho `@parcel/watcher`, `@prisma/engines`, `bcrypt`, `prisma` và `unrs-resolver`. Đây là các install script phục vụ native modules, Prisma engines và kiểm tra Node.js. Khi npm cảnh báo package chưa được duyệt, chạy `npm.cmd install-scripts ls`, review script/phiên bản rồi chỉ approve package cần thiết bằng `npm.cmd install-scripts approve <pkg>`; không approve toàn bộ tự động. [Cơ chế approval của npm](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/).

`npm.cmd audit` kiểm tra lỗ hổng dependencies; kết quả phụ thuộc lockfile và dữ liệu advisory tại thời điểm chạy. Không chạy `npm audit fix --force` chỉ để xóa cảnh báo vì có thể đổi phiên bản ngoài phạm vi tương thích đã pin. Thông báo `funding` chỉ cung cấp thông tin tài trợ, không phải lỗi cài đặt.

Mở `.env` tại root, điền hai connection string được trưởng nhóm cấp riêng theo mục bên dưới. Giữ `NODE_ENV=development`, `FRONTEND_ORIGIN=http://localhost:3000` và `PAYMENT_PROVIDER_MODE=VNPAY_SANDBOX`. File mẫu chỉ chứa placeholder, không kết nối được trước khi điền cấu hình thật. Không ghi đè `.env` đã cấu hình.

Tạo `JWT_SECRET` riêng cho máy bằng helper có sẵn:

```powershell
node backend/scripts/configure-auth-env.cjs
```

Helper tạo secret ngẫu nhiên nếu giá trị còn thiếu/placeholder, giữ secret đã có và không in secret ra terminal. Sau khi cấu hình, kiểm tra Prisma và khởi động:

```powershell
npm run db:validate
npm run db:generate
npm run dev
```

Chờ launcher báo `READY`, mở **http://localhost:3000**. Backend chạy tại `http://127.0.0.1:3001`; liveness tại `http://127.0.0.1:3001/health`. Giữ terminal launcher mở; không chạy thêm server trên cùng port. Nếu PowerShell chặn `npm.ps1`, thay `npm` bằng `npm.cmd`.

### Kết nối database dùng chung

Nhóm dùng **một database Neon PostgreSQL 18**, tên **`brewlite_dev`**, qua **Prisma 7**. Schema, migrations và dữ liệu đã được chuyển lên Neon; thành viên **không cần tạo tài khoản Neon riêng, tạo database Neon mới hoặc tạo PostgreSQL database localhost**.

Ví dụ trong root `.env` — các giá trị dưới đây chỉ là placeholder:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST-POOLER/brewlite_dev?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@HOST-DIRECT/brewlite_dev?sslmode=require"
```

- `DATABASE_URL`: pooled connection cho backend/Prisma Client.
- `DIRECT_URL`: direct connection cho Prisma CLI/migration.
- Cả hai phải trỏ tới **cùng database Neon hiện tại** và bật TLS. Password có ký tự đặc biệt phải được URL-encode.
- Connection string thật do người quản lý dự án cấp qua kênh riêng. Không công khai URL thật trên GitHub và **không commit `.env`**; [.env.example](.env.example) chỉ giữ giá trị mẫu.

Mọi backend cùng kết nối database này sẽ đọc/ghi **dữ liệu dùng chung**: thay đổi sản phẩm, tồn kho hoặc đơn hàng trên một máy có thể được thấy từ máy khác. Chỉ người được phân công quản lý database áp dụng migration/schema change đã duyệt. Quy trình clone thông thường **không chạy migration, reset, seed hoặc restore** lên Neon. Không dùng database chung cho destructive/financial automated tests.

Chi tiết: [Neon development](Docs/NEON_DEVELOPMENT.md). Tài khoản Admin/Staff được provision riêng theo [hướng dẫn vận hành](Docs/NORMAL_SANDBOX_MODE.md).

## 8. Environment Configuration

Phiên/tài khoản/thực đơn có [bản sửa và kiểm chứng2026-11-12](Docs/LOCAL_AUTH_CATALOG_REPAIR.md). Menu gồm7 món; tài khoản lưu trong database, lỗi kiểm tra phiên không có nghĩa User đã bị xóa. Giữ cả frontend/backend chạy: `npm run dev` quản lý hai dịch vụ; khi chạy riêng, dùng hai terminal cho `npm run dev:backend` và `npm run dev:frontend`. Menu/login vẫn mở khi session lỗi; private pages giữ Retry, đăng nhập cần backend hoạt động. `db:seed` chỉ cho database local `_dev`/`_test`, từ chối Neon/remote; không dùng seed/reset để sửa đăng nhập hoặc tạo Admin/Staff.

Checkout có `/cart` và `/checkout` riêng; Order mới có thời hạn thanh toán 10 phút, UNKNOWN vẫn giữ để xác minh. Phiên Customer/Admin/Staff khôi phục qua HttpOnly session 7 ngày, JWT trong memory. Migration hiện tại đã được người quản lý triển khai trên Neon chung; thành viên chỉ validate/generate theo mục 7. [Chi tiết nghiệp vụ](Docs/CHECKOUT_SESSION_UPDATE.md). Auth browser dùng proxy cùng origin `/api/auth/*`; `API_INTERNAL_BASE_URL` mặc định `http://127.0.0.1:3001`.

| File | Nơi đọc / mục đích |
| --- | --- |
| Root `.env` từ [.env.example](.env.example) | NestJS, Prisma config, CLI và launcher local |
| Root `.env.vnpay.local` từ [example](.env.vnpay.local.example) | Overlay private tùy chọn cho VNPAY Sandbox (`dev` / `dev:vnpay`) |
| `frontend/.env.local` từ [example](frontend/.env.local.example) | Override public API URL cho frontend; development mặc định `http://127.0.0.1:3001`, launcher cấp cùng URL |

Backend không yêu cầu `backend/.env`. Không đặt secrets trong `NEXT_PUBLIC_*`. File private được ignore, không đưa lên GitHub.

Next.js đọc `.env*` trong `frontend/`, không đọc root `.env`. Mọi Customer API dùng chung `NEXT_PUBLIC_API_BASE_URL` qua `src/lib/env.ts`. `next.config.ts` cấp URL mặc định chỉ trong development; cấu hình riêng có thể đặt trong `frontend/.env.local`. Với `next build`, phải cấp public API URL trước lúc build (launcher đã cấp); đổi biến khi chạy `next start` không thay URL đã nhúng trong browser bundle, cần build lại. Giữ browser tại `http://localhost:3000` cho đúng `FRONTEND_ORIGIN`/CORS.

Sau khi sửa cấu hình, Next dev tự restart; refresh trang để nạp bundle mới. Nếu chạy frontend standalone khác, restart riêng frontend bằng `npm run dev:frontend`; backend/callback không cần restart cho thay đổi này. Không dừng launcher VNPAY khi còn UNKNOWN cần callback.

| Biến | Ý nghĩa / cấu hình local |
| --- | --- |
| `NODE_ENV` | `development`; Sandbox hiện từ chối production |
| `PORT` | Backend `3001`; frontend `3000` |
| `FRONTEND_ORIGIN` | `http://localhost:3000`, đúng browser origin cho CORS/Return |
| `DATABASE_URL` | Neon pooled endpoint, database `brewlite_dev`, TLS; backend Prisma Client |
| `DIRECT_URL` | Neon direct endpoint cùng database, TLS; Prisma CLI/migration và restore |
| `JWT_SECRET` | Random tối thiểu 32 byte; dùng helper ở bước cài đặt |
| `JWT_EXPIRES_IN` | `3600` giây, policy một giờ |
| `PAYMENT_PROVIDER_MODE` | Chỉ chấp nhận `VNPAY_SANDBOX`; cập nhật `.env` cũ nếu còn `MOCK` |
| `PAYMENT_MOCK_MODE` | Đã bỏ hỗ trợ; phải xóa biến này khỏi `.env` và môi trường shell nếu còn |
| `VNPAY_SANDBOX_ENABLED` | Development Sandbox cần `true` cùng merchant/callback hợp lệ |
| `VNPAY_ACCEPT_NEW_PAYMENTS` | `false`: DRAIN_ONLY; `true`: nhận mới khi config/health cho phép |

Launcher dùng VNPAY Sandbox, cố định port/origin local và quản lý hai cờ Sandbox: bắt đầu DRAIN_ONLY, mở admission sau callback checks. Sửa file không phải hot-toggle và không bỏ qua readiness.



## 9. Payment Setup — VNPAY Sandbox (Mặc định & Duy nhất)

Dùng chung Neon **không tự làm VNPAY hoạt động trên mọi máy**. Vẫn cần merchant credentials và callback/IPN hợp lệ, máy callback owner đang sẵn sàng và cấu hình member đúng. `npm run dev` và `npm run dev:vnpay` đều dùng VNPAY Sandbox; chỉ khởi động launcher khi Sandbox đã cấu hình và callback có thể kiểm chứng. Sandbox lỗi phải báo lỗi/giữ trạng thái chờ; không tự chuyển MOCK hoặc hiển thị thanh toán thành công.

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
BREWLITE_CALLBACK_ROLE=owner
BREWLITE_NGROK_CONFIG=C:/path/to/private/ngrok.yml
```

Ba cờ đầu diễn tả Sandbox sẵn sàng; launcher vẫn tự chuyển DRAIN_ONLY → nhận mới sau checks. `VNPAY_RESULT_URL` tùy chọn nhưng nếu đặt phải đúng URL trên. `VNPAY_ATTEMPT_TTL_SECONDS`, nếu khai báo, dùng `600`; Order mới có deadline10 phút cố định. Attempt cũ giữ expiry đã lưu. [Cart độc lập, timeout an toàn và session sau reload](Docs/CHECKOUT_SESSION_UPDATE.md).

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
2. Đăng nhập, thêm món tại `/cart`; mở `/checkout` và kiểm tra size/topping, promotion, điểm cùng **tổng cuối cùng**.
3. Nhấn thanh toán một lần; hoàn tất trên Sandbox bằng thẻ TEST.
4. Xem result/lịch sử. **Verified IPN** mới settlement; Return chỉ điều hướng/đọc trạng thái.
5. Hủy được xác minh đưa về Home với thông báo/link xem đơn. Nếu còn `PAYMENT_FAILED`, chỉ retry khi backend cho phép hoặc hủy unpaid hợp lệ để tạo đơn mới. `CANCELLED` cần checkout intent/key mới.

Pending/UNKNOWN/REVIEW không được force PAID hoặc tạo giao dịch thay thế. External QueryDr mặc định OFF. Nhận callback không đồng nghĩa SUCCESS E2E đã nghiệm thu.

### F. Troubleshooting

| Hiện tượng | Kiểm tra an toàn |
| --- | --- |
| `EADDRINUSE` 3000/3001 | Server đang giữ cổng. Mở trang/health để kiểm tra trước khi chạy thêm; `dev:status` chỉ áp dụng launcher quản lý. Nếu chuyển sang chạy bằng terminal riêng, dừng đúng launcher và các tiến trình con của repository đang giữ cổng rồi mới chạy lại; không dừng toàn bộ Node trên máy |
| Windows: `'next' is not recognized` khi chạy `dev:frontend` | Kiểm tra `node_modules/.bin/next.cmd` và `node_modules/next/package.json` tại root. Nếu thiếu, dependencies chưa được cài đủ hoặc lần `npm ci` trước bị gián đoạn. Dừng các server của repository theo hướng dẫn bên dưới, chạy `npm.cmd ci` tại root và chờ thành công rồi chạy lại `npm.cmd run dev:frontend`. Dùng lockfile chung của workspace; không cần cài Next toàn cục |
| Windows: `npm ci` báo `EPERM unlink ... .node` | Next/Nest hoặc tiến trình khác đang nạp native module nên Windows không cho npm xóa file. Dừng server của repository trước khi chạy `npm.cmd ci`; terminal đang chạy server dùng `Ctrl+C`, tiến trình nền cần xác minh ownership/PID trước khi dừng. Lần cài thất bại có thể đã xóa dở dependencies; chờ `ci` thành công rồi mới khởi động lại. Không cần reset database hoặc ghi đè `.env` |
| “Chưa kiểm tra được phiên đăng nhập” hoặc đăng nhập báo “Chưa kết nối được” | Kiểm tra `http://127.0.0.1:3001/health`. Nếu frontend đang chạy riêng nhưng backend chưa chạy, mở terminal tại root, chạy `npm.cmd run dev:backend` và giữ terminal mở. Nếu terminal backend vẫn ở watch nhưng health không kết nối được, xem lỗi bootstrap, dừng riêng lệnh backend bằng `Ctrl+C` rồi chạy lại; `Found 0 errors` chỉ xác nhận biên dịch, cần chờ `Nest application successfully started` và health200. Sau đó bấm **Thử lại** hoặc tải lại `http://localhost:3000`. Nếu dùng launcher, kiểm tra `npm.cmd run dev:status` trước để tránh chạy trùng server. POST `/api/auth/session` với Origin/CSRF đúng, không có cookie, trả401 là trạng thái chưa đăng nhập hợp lệ; lỗi kết nối/5xx mới làm bước kiểm tra phiên thất bại |
| `ECONNREFUSED 127.0.0.1:3001` | Backend chưa lắng nghe hoặc đã dừng; xem log `npm.cmd run dev:backend` khi chạy workspace riêng. Nếu log báo `PAYMENT_MOCK_MODE is no longer supported`, xóa biến cũ, đặt `PAYMENT_PROVIDER_MODE=VNPAY_SANDBOX`, `VNPAY_SANDBOX_ENABLED=true` với merchant/callback hợp lệ rồi chạy lại backend; không ghi đè secrets hoặc tự bật admission để sửa lỗi kết nối |
| CORS | Dùng `localhost:3000` nhất quán; `127.0.0.1` là origin khác |
| Thiếu DATABASE_URL/JWT_SECRET | Kiểm tra root `.env`, chạy helper auth nếu còn placeholder |
| Thiếu Prisma Client | `npm run db:generate` tại root |
| VNPAY chưa bật/admission CLOSED | Đọc status/config; UI giải thích tạm ngừng nhận giao dịch mới |
| Callback/ngrok không reachable | Kiểm tra mạng, profile/domain đăng ký và ngrok config; giữ continuity cho Attempt mở |
| Return báo `ERR_NGROK_3200` | Domain callback đang offline. Với Neon dùng chung, máy `member` cần máy callback `owner` khôi phục đúng domain/profile hiện có: owner kiểm tra `npm.cmd run dev:status`, dùng `npm.cmd run dev:recover` nếu runtime còn sống; nếu chưa có runtime, xác minh cổng và cấu hình owner trước khi chạy `npm.cmd run dev:vnpay`. Xem [phân công callback owner/member](Docs/VNPAY_NEON.md). Kiểm tra trạng thái đơn tại `/orders`; chưa có verified IPN thì không suy thành công/thất bại, không trả tiền lại hoặc ép trạng thái. Tải lại Return chỉ khôi phục điều hướng, không thay IPN xác nhận thanh toán |
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

Database integration chỉ dành cho người chuẩn bị môi trường test PostgreSQL **cô lập**, không phải bước clone/chạy ứng dụng. Không chạy `test:database` hoặc browser harness tạo dữ liệu trên Neon chung. Các suite có điều kiện database/schema riêng; đọc [database test config](backend/jest.database.config.cjs) và [foundation tests](backend/test/database/foundation.spec.ts) trước khi cấu hình. Generate Prisma Client trước typecheck backend.

Browser harness/reconciliation có điều kiện riêng, không chạy tùy tiện trên database demo. Con số PASS lịch sử không bảo đảm kết quả trên máy mới. Không cần chạy migrations, seed hay gateway transactions để kiểm tra tài liệu.

## 14. Git Workflow / Đóng góp

Làm việc trên nhánh được phân công, kiểm tra diff và chỉ stage các file hợp lệ:

```powershell
git switch sang
# Kiểm tra diff và chọn đúng từng path để stage
git add README.md
git diff --cached
git commit -m "docs: update BrewLite setup guide"
git push -u origin sang
```

Review trước khi merge `sang` vào `main`; tuân thủ branch protection và quy trình của nhóm. Không force push, không bỏ qua conflict. Không commit secrets, `.env`, dump, log hoặc generated artifacts; không `git add .` khi worktree còn thay đổi chưa phân loại.

## 15. Trạng thái dự án

Source có Customer/MOCK, Admin/Staff, Loyalty redemption, VNPAY verified IPN/Return read-only, cancel/recovery UX và Normal launcher. Không coi successful PAID Sandbox E2E đã nghiệm thu chỉ từ tests/giao dịch hủy.

Docker Compose theo PDF chưa có trong repository; browser matrix, hiệu năng và clean-clone đầy đủ cần bằng chứng riêng. Shared Staging/production chưa triển khai. Việc còn lại: [DEVELOPMENT_PLAN](Docs/DEVELOPMENT_PLAN.md).
