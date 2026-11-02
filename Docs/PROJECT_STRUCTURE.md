# BrewLite — Cấu trúc repository

I03 amendment2026-10-31: `backend/src/ingredients/ingredient-catalog.ts` là file chỉnh danh mục duy nhất, có label hiển thị và kiểm tra cấu hình; IngredientService cung cấp metadata cho frontend, không có import code backend sang frontend. Kiểm thử mới `backend/test/ingredient-catalog.spec.ts`, mở rộng database/frontend tests và browser harness cho luồng danh mục tập trung. [Hướng dẫn](I03_RECEIVING_CATALOG.md).

I03 thêm `backend/src/ingredients/ingredient-catalog.ts`, migration `20261029170000_inventory_egg_unit`; sửa policy/DTO/service/controller I01, frontend unit labels/forms/load và tests tương ứng. Script fallback nhận `--egg-unit`, package scripts `db:check:inventory-catalog`/`db:migrate:inventory-catalog`. [Contract](I03_RECEIVING_CATALOG.md).

I02 bổ sung `frontend/src/app/admin/receipts/page.tsx`, `admin/products/inventory/page.tsx`, sửa route kho/nguyên liệu và nav/forms I01 hiện có; migration `20261029150000_inventory_categories` cố định metadata ngưỡng. Script `backend/scripts/apply-ingredient-inventory.cjs --categories` chỉ chọn migration I02; không cài package hoặc đổi cấu trúc backend. [Contract](I02_INVENTORY_CATEGORIES.md).

I01 bổ sung `backend/src/ingredients/{ingredient.module,ingredient.controller,ingredient.service,ingredient.dto,ingredient-policy}.ts`, migration `20261029100000_ingredient_inventory`, unit/database tests nguyên liệu; frontend `components/ingredient-{inventory,forms}.tsx`, `lib/api/ingredients.ts`, `types/ingredient.ts`, CSS riêng và routes `/admin/ingredients`, `/operator/ingredients`. Không chuyển hoặc xây dựng lại cấu trúc cũ. [Contract](I01_INGREDIENT_INVENTORY_CONTRACT.md).

Amendment2026-10-22: Customer có thêm `/checkout` độc lập `/cart`; `auth/session.service.ts`, `orders/payment-expiration.worker.ts`, `payments/payment-receipt.worker.ts`, frontend `auth-session`, `checkout-view`, `pending-order`, `payment-countdown`. [Contract/source/test mapping](CHECKOUT_SESSION_UPDATE.md).

Cây dưới đây mô tả source hiện có, không phải blueprint tạo thư mục trong tương lai.
Một npm workspace root quản lý hai ứng dụng; không có Dockerfile/Compose hoặc CI workflow trong cây hiện tại.

```text
SWE_Project/
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── .gitignore
├── .env.example
├── .env.vnpay.local.example
├── frontend/
│   ├── package.json
│   ├── .env.local.example
│   ├── next.config.ts
│   ├── next-env.d.ts
│   ├── tsconfig.json
│   ├── public/                    # Assets menu/UI; không phải ảnh evidence trong Docs
│   ├── src/
│   │   ├── app/                   # App Router: xem bảng route bên dưới
│   │   ├── components/            # Catalog, Cart/Checkout, payment result, operator/admin
│   │   ├── lib/                   # API clients, auth/cart/context và capability mapping
│   │   └── types/                 # Kiểu dữ liệu frontend
│   └── test/                      # Node fixture tests và browser harness
├── backend/
│   ├── package.json
│   ├── nest-cli.json
│   ├── tsconfig.json
│   ├── prisma.config.ts           # Đọc root .env; schema/migrations/seed config
│   ├── prisma/
│   │   ├── schema.prisma          # 18 models nghiệp vụ, PostgreSQL
│   │   ├── migrations/            # 13 migration directories và migration_lock.toml
│   │   ├── seed.cjs               # Catalog/promotion development; không seed tài khoản
│   │   └── verify.cjs
│   ├── scripts/
│   │   ├── configure-auth-env.cjs  # Tạo JWT secret local khi thiếu/placeholder
│   │   ├── provision-operator.cjs  # Create-only STAFF/ADMIN, guard local development
│   │   ├── reconcile-loyalty.cjs   # Đối soát read-only, không tự repair
│   │   └── verify-inventory-migrations.cjs
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── health.controller.ts
│   │   ├── config/                # Validate environment/provider
│   │   ├── database/              # Prisma + PostgreSQL adapter
│   │   ├── common/                # Error envelope, HTTP config, idempotency
│   │   ├── auth/                  # JWT/roles guards, credentials, register/login
│   │   ├── users/
│   │   ├── catalog/               # Public catalog + Admin products/options/inventory
│   │   ├── cart/
│   │   ├── pricing/               # Giá server, promotion và redemption preview
│   │   ├── orders/                # Owner/operator/admin APIs và state machine
│   │   ├── loyalty/               # Award, journal, debt, balance/history
│   │   ├── payments/              # MOCK, Attempt/IPN/Return/zero/reconcile/admission
│   │   │   └── vnpay/             # Config, signing, protocol và verification helpers
│   │   └── callback-ingress/      # HTTP allowlist độc lập với backend restart
│   └── test/
│       ├── database/              # PostgreSQL integration, schema test riêng
│       └── fixtures/              # Synthetic gateway/config fixtures
├── scripts/
│   ├── dev-runtime.cjs            # CLI/build/ownership/private control endpoint
│   ├── dev-runtime-lib.cjs        # Config, dependency reads, health/probes
│   ├── dev-runtime-manager.cjs    # Lifecycle MOCK/VNPAY, drain/recovery/stop
│   ├── verify-b08-docs.cjs        # Links, PDF hash và B08 evidence input
│   └── test/dev-runtime.test.cjs
├── ops/ngrok-callback.example.yml
└── Docs/
    ├── BrewLite-CongNghePhanMem.pdf
    ├── REQUIREMENTS.md
    ├── ARCHITECTURE.md
    ├── DATABASE_DESIGN.md
    ├── API_DESIGN.md
    ├── PROJECT_STRUCTURE.md
    ├── DECISIONS.md
    ├── DEVELOPMENT_PLAN.md
    ├── TRACEABILITY_MATRIX.md
    ├── DESIGN_REVIEW.md
    ├── NORMAL_SANDBOX_MODE.md
    ├── P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md
    ├── L00_LOYALTY_REDEMPTION_CONTRACT.md
    └── ...                        # Contract nghiệp vụ/payment và fixture B08 được script đọc
```

## Routing và tổ chức code

| Khu vực | Routes hiện có |
| --- | --- |
| Customer | `/`, `/products/[id]`, `/register`, `/login`, `/cart`, `/orders`, `/orders/[id]/confirmation`, `/loyalty` |
| Payment result | `/payments/vnpay/result`; Checkout nằm trong `/cart`, không có `app/checkout` riêng |
| Staff | `/operator/orders`, `/operator/orders/[id]`, `/operator/orders/completed` |
| Admin | `/admin`, `/admin/orders`, `/admin/orders/[id]`, `/admin/products`, `/admin/products/[id]/options`, `/admin/toppings`, `/admin/inventory` |

Modules NestJS nằm trực tiếp dưới `backend/src`, không có lớp `src/modules/`.
Frontend gọi REST qua `lib/api`, không import Prisma hay merchant secrets.
Inventory/Promotion không có database/service riêng bên ngoài modular monolith.

## Environment và runtime

- Root `.env`: backend, Prisma và CLI; `.env.example` là mẫu được chia sẻ.
- `.env.vnpay.local`: overlay private của Normal VNPAY launcher; mẫu portable ở root.
- `frontend/.env.local`: dành cho frontend standalone, chỉ public API URL.
- `.brewlite/`: generated build snapshots, state/controller và artifacts local được ignore; không phải source bàn giao.
- `.tmp/`: helpers phiên kiểm thử cũ, được ignore; Normal Mode không phụ thuộc vào session ID/helper cũ.

Không liệt kê caches, node_modules, generated Prisma Client, `.next`, `dist` hoặc ảnh evidence đã dọn.
Không xóa các input legacy được script đọc trong đợt tài liệu này; xem [README dự án](../README.md).
Thiết kế: [Architecture](ARCHITECTURE.md), [API](API_DESIGN.md), [Database](DATABASE_DESIGN.md).
