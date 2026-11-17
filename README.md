# BrewLite — Hướng dẫn Cấu hình và Chạy Dự án

## 1. Yêu cầu môi trường

- **Node.js:** `>=24.11` và `<25` (khuyến nghị `v24.15.0`)
- **npm:** `>=11` và `<12`
- **Git:** `2.x`
- **Next.js:** `16.4.6`, cố định cùng phiên bản ở frontend/backend; `eslint-config-next` dùng `16.4.6`.

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

```dotenv
# Sample values only: replace them in your local .env.
NODE_ENV=development
# Backend HTTP port; frontend uses 3000.
PORT=3001
# Browser origin allowed by CORS.
FRONTEND_ORIGIN=http://localhost:3000
# Sample credentials only. PostgreSQL must be started separately.
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
JWT_SECRET=""
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

VNPAY_TMN_CODE="YOUR_SANDBOX_TMN_CODE"
VNPAY_HASH_SECRET="YOUR_SANDBOX_HASH_SECRET"

VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html

VNPAY_RETURN_URL=http://localhost:3001/payments/vnpay/return
VNPAY_IPN_URL=https://implicate-country-crafty.ngrok-free.dev/payments/vnpay/ipn
BREWLITE_CALLBACK_ROLE=member

VNPAY_RESULT_URL=http://localhost:3000/payments/vnpay/result

```

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

## 4. Quy tắc và vị trí code cần đọc

Các ghi chú khôi phục đã được gộp vào comment cạnh code. Đường dẫn API và quyền nằm trong controller, payload trong DTO, quan hệ trong Prisma, CHECK/trigger trong migration; không cần thư mục tài liệu riêng để chạy ứng dụng.

| Phần | Nơi bảo trì và truy vết |
| --- | --- |
| I01/I03 — danh mục kho | [ingredient-catalog.ts](backend/src/ingredients/ingredient-catalog.ts): 18 mặt hàng hiện hành, nhãn hiển thị và identity cũ |
| I07/I09 — tồn, lượng giữ và cảnh báo | [ingredient-policy.ts](backend/src/ingredients/ingredient-policy.ts), [ingredient.service.ts](backend/src/ingredients/ingredient.service.ts), [UI/API kho](frontend/src/lib/api/ingredients.ts) |
| I07 — còn món theo công thức S/M/L | [drink-recipes.ts](backend/src/catalog/drink-recipes.ts), [product-ingredients.ts](backend/src/catalog/product-ingredients.ts), [catalog.service.ts](backend/src/catalog/catalog.service.ts), [pricing.service.ts](backend/src/pricing/pricing.service.ts), [cart-options.tsx](frontend/src/components/cart-options.tsx) |
| I07 — nhập công thức khi tạo sản phẩm | [form tạo sản phẩm](frontend/src/components/admin-products.tsx), [dòng công thức](frontend/src/components/product-recipe-fields.tsx), [DTO](backend/src/catalog/admin-product.dto.ts), [lưu sản phẩm](backend/src/catalog/admin-product.service.ts), [đọc công thức theo ID](backend/src/catalog/product-recipes.ts), [kiểm tra database](backend/test/database/size-recipes.spec.ts) |
| I08 — kiểm kê và đối chiếu lịch sử | [inventory-control.ts](backend/src/ingredients/inventory-control.ts), phương thức reviewCount trong IngredientService |
| API kho và phân quyền | [ingredient.controller.ts](backend/src/ingredients/ingredient.controller.ts), [ingredient.dto.ts](backend/src/ingredients/ingredient.dto.ts) |
| O01 — hủy và theo dõi đơn | [cancellation-window.ts](backend/src/orders/cancellation-window.ts), [order.service.ts](backend/src/orders/order.service.ts), [order-tracking.tsx](frontend/src/components/order-tracking.tsx) |
| Hỗ trợ và ghi nhận hoàn tiền | [order-aftercare.controller.ts](backend/src/orders/order-aftercare.controller.ts), [order-aftercare.dto.ts](backend/src/orders/order-aftercare.dto.ts) |
| Khôi phục phiên và giữ cổng phân quyền | [auth-session.tsx](frontend/src/components/auth-session.tsx), [auth-session.ts](frontend/src/lib/auth-session.ts), [session.service.ts](backend/src/auth/session.service.ts) |
| Dữ liệu và ràng buộc | [schema.prisma](backend/prisma/schema.prisma), [migrations](backend/prisma/migrations), [xử lý snapshot nguyên liệu](backend/src/ingredients/order-ingredients.ts) |

Các quyết định đang áp dụng theo yêu cầu người dùng:

- Kho giữ đủ 40 bản ghi, kể cả dữ liệu cũ; danh mục hiện hành chỉ hiển thị 18 mặt hàng gồm 12 nguyên liệu và 6 vật dụng. Đổi nhãn bằng `label`, giữ tên/đơn vị/identity dùng trong lịch sử; initializer chỉ tạo dòng thiếu với tồn 0.
- “Tồn thực tế” là `quantity`; “Có thể bán” là `quantity - reservedQuantity`. Trạng thái dùng lượng có thể bán: 0 là hết, dương dưới 3 kg hoặc 2 lít là sắp hết; bằng ngưỡng là còn hàng. Các đơn vị lịch sử khác giữ quy tắc cũ. Ngưỡng chênh lệch kiểm kê là cấu hình riêng.
- Bỏ quản lý tồn riêng cho sản phẩm. Món/size chỉ còn khi nguyên liệu khả dụng đủ pha ít nhất một ly theo công thức đã khôi phục: Cappuccino, Latte, Cold brew, Đen đá, Asian Dolce Latte, Matcha Coldwisk và Cacao đá, mỗi món có S/M/L. Topping kem/caramel cũng có định lượng theo size. Món/topping chưa có công thức bị khóa bán; không dùng `Product.stock` làm phương án thay thế. `isActive` và size mở bán vẫn được tôn trọng.
- Công thức dùng đúng gram/ml và chuyển chính xác sang kg/lít, cộng tổng nguyên liệu dùng chung giữa các món/size/topping trong đơn. Nước vẫn có trong công thức pha chế nhưng không thuộc nguyên liệu quản lý tồn; 6 vật dụng không bị trừ khi bán đồ uống. Nguyên liệu dùng identity `tên (công thức)` hiện có, không tạo thêm tồn hoặc thay dòng lịch sử.
- Tạo đơn PENDING giữ nguyên liệu và đóng băng định lượng trong cùng transaction; PAID tiếp tục giữ, PREPARING mới trừ tồn thực tế. Hủy/hết hạn/thanh toán thất bại giải phóng phần giữ; retry lấy lại đúng snapshot gốc. Đơn cũ chưa có snapshot tiếp tục theo chính sách tồn sản phẩm cũ để giữ đúng lịch sử.
- Trang quản lý sản phẩm hiển thị “Còn món”, “Tạm hết”, size còn hoặc “Chưa có công thức”. Thực đơn/chi tiết và danh sách quản trị cập nhật mỗi 20 giây khi đang mở, hoặc khi quay lại cửa sổ; backend luôn kiểm tra lại trong giao dịch đặt đơn. Trang `/admin/products/inventory` chuyển về `/admin/products`; API điều chỉnh tồn sản phẩm và `GET /admin/inventory` đã bỏ đăng ký, trả 404. Kho nguyên liệu tại trang `/admin/inventory` vẫn hoạt động.
- Khách được hủy PAID trong 120 giây sau `paidAt`. Đúng mốc 120 giây khóa hủy của khách và cho nhân viên bắt đầu pha chế; hết đồng hồ không tự đổi trạng thái đơn. Backend dùng giờ server.
- Nút hủy nằm trong phần **Theo dõi đơn hàng** ở checkout đã thanh toán, chi tiết đơn và kết quả VNPAY. Popup thanh toán thành công có liên kết **Hủy đơn hàng** dẫn tới phần này. Hết hạn hoặc đã pha chế, nút bị khóa kèm lý do; khách có thể gửi hỗ trợ.
- Hủy giải phóng phần nguyên liệu chưa dùng hoặc hoàn tồn sản phẩm theo snapshot/chính sách gốc, thu hồi điểm và tạo một yêu cầu hoàn tiền trong cùng giao dịch. Không trả nguyên liệu CONSUMED về kho, không hoàn tồn/điểm hai lần khi retry.
- Payment thu thành công vẫn SUCCEEDED; hoàn tiền được theo dõi riêng. Admin phê duyệt rồi ghi nhận mã giao dịch/bằng chứng hoàn tiền thực tế; ứng dụng không tự gọi API chuyển tiền. Lịch sử trạng thái không được tạo bù giả cho đơn cũ.
- Khôi phục phiên thử tối đa 3 lần khi kết nối/API tạm lỗi, chờ 1,5 rồi 3 giây giữa các lần; có thể thử lại bằng nút, khi có mạng hoặc quay lại cửa sổ. Lỗi 5xx/mạng không bị coi là đăng xuất, không xóa phiên đã lưu. Phản hồi 401 vẫn kết thúc phiên; khách chưa đăng nhập tiếp tục bị chặn khỏi trang riêng. Không thay contract API hoặc bỏ xác minh phiên để mở trang.

Giữ contract ID TEXT/default sequence, kể cả ID số/UUID cũ, `customerOrderCode`, cách tính tiền và VNPAY của clone; kiểm tra/giữ tồn trong đơn mới chuyển sang công thức theo yêu cầu người dùng. Các phần kho/O01/I07 lấy lại từ backup local `SWE_Project_Backup_1511`.

Contract khả dụng bổ sung: `GET /products` trả `sizeAvailability[{size,available,maxQuantity}]`; chi tiết trả `sizes[].available/maxQuantity` và `toppings[].availableSizes`. Admin product trả `available`, `recipeConfigured`, `availableSizes`; trường `stock` chỉ giữ để tương thích dữ liệu cũ. `Cart.items[].stock` là số ly pha được với cấu hình đã chọn, không còn là tồn sản phẩm. Thiếu nguyên liệu hoặc chưa có công thức trả `409 OUT_OF_STOCK`. Các thao tác giữ/giải phóng/tiêu hao ghi journal theo snapshot, action và cycle để chống ghi lặp.

### Thêm món mới kèm công thức trên giao diện

Đây là mở rộng I07 theo yêu cầu người dùng: tại `/admin/products` chọn **Tạo sản phẩm mới**, nhập tên/giá/ảnh, chọn các size muốn bán. Ngay dưới từng size, chọn nguyên liệu và nhập định lượng cho **một ly**, dùng số nguyên dương theo **g** (kho kg) hoặc **ml** (kho lít). Có thể thêm/xóa dòng; mỗi nguyên liệu chỉ xuất hiện một lần trong một size. Nước lọc nhập riêng bằng ml, không giữ/trừ kho. Form dùng 12 nguyên liệu hiện hành lấy từ API kho, không thêm vật dụng hoặc mở rộng danh mục 18 mặt hàng. Nếu tải nguyên liệu lỗi, form giữ dữ liệu đã nhập và có nút tải lại.

**Lưu sản phẩm** ghi sản phẩm, size, topping và công thức trong cùng transaction. Món mới có công thức lưu database không cần sửa `drink-recipes.ts`; chỉ bán khi size đang bật và đủ nguyên liệu khả dụng. Chức năng này nhập công thức lúc tạo mới; form sửa sản phẩm hiện tại vẫn chỉ sửa thông tin sản phẩm.

Contract `POST /admin/products` vẫn chỉ dành cho ADMIN, bổ sung `sizes[].recipe[{ingredientId,unit,amount}]` (`unit` là `g` hoặc `ml`, `amount` là chuỗi số nguyên 1–999999999), và `sizes[].waterMl` (chuỗi số nguyên 0–999999999, mặc định 0). Nếu gửi công thức thì phải gửi đủ cho mọi size trong yêu cầu; nguyên liệu phải thuộc danh mục hiện hành, đơn vị phải khớp và không được trùng. Sai dữ liệu trả `400 VALIDATION_ERROR`, không tạo sản phẩm dở dang. API cũ có thể bỏ toàn bộ các trường công thức để giữ tương thích; form mới yêu cầu đủ công thức từng size.

Quyết định kỹ thuật: `Product.hasCustomRecipe` chọn nguồn công thức; `ProductRecipeIngredient` liên kết mã sản phẩm/size/nguyên liệu và lưu định lượng kg/lít bằng Decimal 3 số lẻ. Công thức nhập mới ưu tiên theo ID, kể cả khi tên trùng một món cũ; đổi tên không làm mất công thức. Size mới thêm sau mà chưa có công thức bị khóa, không lấy công thức từ tên món thay thế. Bảy món cũ tiếp tục dùng nguyên công thức đã chốt trong code. Đơn đã đặt giữ snapshot gốc khi pha chế, hủy hoặc thử lại thanh toán.

Schema bổ sung tại [migration tạo công thức sản phẩm](backend/prisma/migrations/20261117120000_product_creation_recipes/migration.sql), hỗ trợ FK UUID/TEXT của database hiện có. Bảng mới `product_size_recipe_ingredients` dùng tên riêng để giữ nguyên các bảng `product_recipes`/`product_recipe_ingredients` cũ còn trong database khôi phục. Cần đối chiếu migration ledger trước khi áp dụng đúng migration mới, sau đó `npm run db:generate` và khởi động lại ứng dụng. Không reset/seed hoặc áp dụng lại các migration cũ; migration mới chỉ thêm cấu hình, không nhập/chỉnh tồn và không chuyển đổi lịch sử đơn.

## 5. Kiểm tra và bảo toàn dữ liệu

Database đồ án đã có các migration kho/O01/I09 khi khôi phục ngày 17/11/2026. Không seed/reset hoặc tự chạy lại toàn bộ migration lên database đang có dữ liệu; khi dùng database khác cần đối chiếu schema và migration ledger trước. Không sửa SQL migration đã áp dụng, kể cả để đổi một comment dẫn tới tài liệu cũ, vì checksum phải được giữ nguyên.

Các kiểm tra có ghi dữ liệu phải dùng PostgreSQL local riêng, tên database kết thúc `_test`. `TEST_DATABASE_URL` phải trỏ tới database đó; các file test database kiểm tra điều kiện này trước khi chạy. Kiểm tra dữ liệu đồ án chỉ dùng kết nối read-only và tránh khởi động worker nghiệp vụ.

```powershell
npm run lint
npm run typecheck --workspace frontend
npm run db:validate
npm run build

# Chạy từ thư mục gốc; kiểm tra policy/controller, không cần database thật.
npm run test --workspace backend -- --runInBand --runTestsByPath test/cancellation-window.spec.ts test/ingredient-unit-warnings.spec.ts test/inventory-control.spec.ts
node --test frontend/test/order-tracking.test.mjs frontend/test/ingredients.test.mjs

# Chỉ chạy sau khi đã cấu hình TEST_DATABASE_URL tới database local riêng.
npm run test:database -- --runInBand --runTestsByPath test/database/ingredient-unit-warnings.spec.ts test/database/order-aftercare.spec.ts

# Công thức, khả dụng và phần tồn sản phẩm đã bỏ.
npm run test --workspace backend -- --runInBand --runTestsByPath test/drink-recipes.spec.ts test/product-recipes.spec.ts test/product-ingredients.spec.ts test/admin-products.spec.ts test/pricing.spec.ts test/cart-service.spec.ts test/cart-payment-preservation.spec.ts test/admin-inventory.spec.ts
node --test frontend/test/catalog.test.mjs frontend/test/cart.test.mjs frontend/test/admin-products.test.mjs frontend/test/admin-options.test.mjs
npm run test:database -- --runInBand --runTestsByPath test/database/size-recipes.spec.ts
```

Các kiểm tra này truy vết ranh giới cảnh báo 0/dưới/bằng/vượt với lượng giữ; mốc hủy 119/120/121 giây; hủy/pha chế đồng thời; chống release/refund lặp; rollback khi ghi refund lỗi; quyền/owner; và ràng buộc lịch sử bất biến. Test frontend xác nhận đồng hồ server, nút hủy, khóa pha chế và phản hồi từ phiên đăng nhập cũ.

Bằng chứng khôi phục ngày 17/11/2026: backend kho 84 kiểm tra, frontend kho 31/31, database ngưỡng 5/5 và database O01 UUID/TEXT 32/32 đã đạt. Kiểm tra API read-only xác nhận 40/18/12/6, checksum migration và fingerprint 38 bảng giữ nguyên. Browser local đã kiểm tra khách/Staff/Admin, tải lại, hỗ trợ, duyệt hoàn tiền và ảnh desktop/mobile. Chưa kiểm thử chuyển tiền/callback VNPAY thật.

Lượt bổ sung nút hủy sau thanh toán cùng ngày: tracking 8/8, checkout 14/14 và operator-orders 13/13 đạt khi chạy từng file riêng. Browser local đạt 6/6 luồng, xác nhận hủy ngay tại checkout, tiếp tục thấy yêu cầu hoàn tiền, và nút bị khóa có lý do sau khi bắt đầu pha chế. Gộp tài liệu chỉ đổi comment ở backend/schema; các script kiểm thử chuyển nơi xuất evidence sang `.tmp/`.

Bộ hồi quy tổng chưa xanh: backend còn assertion timeout VNPAY return; frontend có assertion/timeout cũ trong lịch sử/thanh toán, đã tái hiện trên clone gốc. Lỗi provisioning do sandbox chặn spawn đã chạy riêng ngoài sandbox đạt. Các kết quả trên là bằng chứng của lượt kiểm tra đã nêu, cần chạy lại khi sửa logic liên quan.

Ảnh và báo cáo do các script browser/migration tạo nằm ở `.tmp/browser-evidence/`; báo cáo khôi phục local ở `.tmp/`. Đây là dữ liệu kiểm thử được Git bỏ qua, không cần cho runtime. Không đưa token, mật khẩu hay dữ liệu nghiệp vụ thô vào báo cáo.

Vá Next.js ngày 17/11/2026: nâng từ 16.4.3 lên 16.4.6, đồng bộ gói lint và `package-lock.json`. Các bản vá bảo mật được công bố từ [16.4.5](https://github.com/vercel/next.js/releases/tag/v16.4.5); [16.4.6](https://github.com/vercel/next.js/releases/tag/v16.4.6) giữ các bản vá và bổ sung sửa lỗi. Sau khi lấy code mới, chạy `npm ci` rồi khởi động lại frontend để tiến trình đang chạy nạp phiên bản mới. Không tắt cảnh báo hoặc dev indicator để xử lý lỗi này.

Lượt kiểm chứng bản vá: lint và build frontend/backend đạt; browser Edge với Turbopack 16.4.6 không còn Security Insight, trang đăng nhập hiển thị và không có runtime exception. Audit online không còn mục Next.js; vẫn có 29 mục ở các gói khác (27 moderate, 2 high), chưa nâng các gói đó trong tác vụ này. Hồi quy backend đạt 1001/1002, còn assertion VNPAY return cũ; frontend đạt 273/278, còn đúng 4 assertion và 1 timeout cũ ở thanh toán/lịch sử đơn đã ghi ở trên. Evidence local: `.tmp/next-security-smoke/`, `.tmp/next-audit-online-after.json` và `.tmp/next-patch-*.log`.

Lượt chuyển sản phẩm sang công thức ngày 17/11/2026: backend liên quan 160/160, frontend 57/57, PostgreSQL công thức 34/34, hồi quy database O01/ngưỡng 37/37 và browser Edge 6/6 đạt. Browser xác nhận bỏ màn hình tồn sản phẩm, khóa size/topping thiếu nguyên liệu, cập nhật món sau giữ/hủy đơn, thêm giỏ khi `Product.stock = 0`, không có runtime exception và không tràn ngang desktop/mobile. Kiểm tra read-only database đồ án xác nhận 40/18/12/6 và fingerprint cả 38 bảng giữ nguyên; có 7 sản phẩm, 6 đang bật bán, không tự bật lại sản phẩm ngừng bán. Lượt hồi quy backend tổng đạt 1016/1017, còn assertion timeout VNPAY return cũ; các ca liên quan được chạy lại sau chỉnh sửa cuối. Báo cáo nằm tại `.tmp/recipe-*.log`, `.tmp/recipe-live-result.json` và `.tmp/recipe-browser/`. Không chạy migration/seed hoặc ghi tồn vào database đồ án.

Khắc phục màn hình kẹt kiểm tra phiên ngày 17/11/2026: frontend auth/session/RBAC 26/26, lint, typecheck và build đạt. Browser 7/7 xác nhận tự phục hồi sau một lỗi API, dừng sau 3 lần khi lỗi kéo dài, phục hồi qua nút/online/focus, vẫn chuyển khách khỏi trang riêng và hiển thị được thực đơn tại `localhost:3000` với backend đang chạy. Không có runtime exception, không ghi database. Evidence ở `.tmp/auth-recovery-*.log` và `.tmp/auth-recovery-browser/`.

Nhập công thức trong form tạo sản phẩm ngày 17/11/2026: backend liên quan 150/150, frontend liên quan 59/59, PostgreSQL local `_test` 40/40; lint, typecheck frontend, Prisma validate và build frontend/backend đạt. Edge headless đạt 5/5 luồng: chọn nguyên liệu theo size, chặn định lượng sai/trùng, thêm/xóa và giữ dữ liệu khi đổi size, lưu một sản phẩm/công thức rồi tải lại, mua size mới và giữ/giải phóng đúng nguyên liệu. Không có runtime exception hoặc tràn ngang ở 390/1366 px. Chỉ migration `20261117120000_product_creation_recipes` đã được áp dụng sau đối chiếu; fingerprint 37 bảng nghiệp vụ cũ và toàn bộ 28 dòng ledger cũ giữ nguyên. Các checksum lịch sử đã lệch file clone từ trước được giữ nguyên, không sửa migration hoặc reset database để đồng bộ lại. Kiểm tra API read-only sau migration đạt, fingerprint cả 39 bảng hiện tại giữ nguyên trong lượt đọc. Mọi thao tác tạo món/đặt đơn kiểm thử dùng database local; database đồ án chỉ thêm schema và dòng ledger của migration mới. Evidence local: `.tmp/product-creation-recipes-browser/`, `.tmp/product-recipes-preflight.json`, `.tmp/product-recipes-live-result.json`. Phạm vi hiện tại chỉ nhập công thức khi tạo mới, chưa có giao diện sửa công thức món đã lưu; không kiểm thử callback/chuyển tiền VNPAY thật trong lượt này.
