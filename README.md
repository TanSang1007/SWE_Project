# BrewLite — Hướng dẫn Cấu hình và Chạy Dự án

## 1. Yêu cầu môi trường

- **Node.js:** `>=24.11` và `<25` (khuyến nghị `v24.15.0`)
- **npm:** `>=11` và `<12`
- **Git:** `2.x`

> **Lưu ý:** Mọi câu lệnh bên dưới đều chạy tại **thư mục gốc `SWE_Project`**. Nếu Windows PowerShell chặn `npm.ps1`, hãy thay `npm` bằng `npm.cmd`.

---

## 2. Cài đặt và Cấu hình (`.env`)

### Bước 1: Clone dự án và cài đặt thư viện

```powershell
git clone https://github.com/TanSang1007/SWE_Project.git
cd SWE_Project
npm ci
```

### Bước 2: Tạo file `.env`

tạo file .env và copy đoạn mã bên dưới

# Copy to .env at the repository root for local development.
NODE_ENV=development
# Backend HTTP port; frontend uses 3000.
PORT=3001
# Browser origin allowed by CORS.
FRONTEND_ORIGIN=http://localhost:3000
# Sample credentials only. PostgreSQL must be started separately.
DATABASE_URL="postgresql://neondb_owner:npg_8iuAesNFvjU4@ep-late-lab-aou9e121-pooler.c-2.ap-southeast-1.aws.neon.tech/brewlite_dev?sslmode=require&channel_binding=require"
DIRECT_URL="postgresql://neondb_owner:npg_8iuAesNFvjU4@ep-late-lab-aou9e121.c-2.ap-southeast-1.aws.neon.tech/brewlite_dev?sslmode=require&channel_binding=require"
JWT_SECRET=040f94022fbf4d1362a11207589284ace97e2ba9ab1e3a7b73e961b3e2bf147e
JWT_EXPIRES_IN=3600

# ===============================
# PAYMENT CONFIGURATION
# ===============================

PAYMENT_PROVIDER_MODE=VNPAY_SANDBOX

# VNPAY Sandbox
VNPAY_SANDBOX_ENABLED=true
VNPAY_ACCEPT_NEW_PAYMENTS=true

VNPAY_ENV=SANDBOX
VNPAY_VERSION=2.1.0

VNPAY_TMN_CODE=CKBIFFQP
VNPAY_HASH_SECRET=OPAUCWCOMGWGFXEHPLZOSPFFAMBQDRRJ

VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html

VNPAY_RETURN_URL=http://localhost:3001/payments/vnpay/return
VNPAY_IPN_URL=https://implicate-country-crafty.ngrok-free.dev/payments/vnpay/ipn
BREWLITE_CALLBACK_ROLE=member

VNPAY_RESULT_URL=http://localhost:3000/payments/vnpay/result

### Bước 3: Tự động tạo `JWT_SECRET` và khởi tạo Prisma Client

```powershell
node backend/scripts/configure-auth-env.cjs
npm run db:validate
npm run db:generate
```

---

## 3. Chạy dự án

### Cách 1: Chạy riêng Backend và Frontend (2 cửa sổ Terminal tại thư mục gốc `SWE_Project`)

- **Terminal 1 (Chạy Backend tại `http://127.0.0.1:3001`):**
  ```powershell
  npm run dev:backend
  ```

- **Terminal 2 (Chạy Frontend tại `http://localhost:3000`):**
  ```powershell
  npm run dev:frontend
  ```

Sau khi cả hai khởi động xong, mở trình duyệt tại: **http://localhost:3000**

---

### Cách 2: Chạy gộp bằng Launcher

Chạy tại thư mục gốc `SWE_Project`:

```powershell
npm run dev
```

Các lệnh quản lý (chạy ở một cửa sổ Terminal khác):
```powershell
npm run dev:status   # Kiểm tra trạng thái chạy
npm run dev:stop     # Dừng dự án
```
