# I02 — Vật dụng, nguyên liệu và nhập hàng

Amendment hiện hành2026-10-31: [I03 — Quản lý danh mục trong một file](I03_RECEIVING_CATALOG.md) thay form thêm mặt hàng trên UI kho bằng danh mục trong `ingredient-catalog.ts`. Kho/phiếu mới chỉ hiển thị các mặt hàng còn trong danh mục; dữ liệu tồn và chứng từ cũ vẫn được giữ. Các mô tả form tạo thủ công dưới đây là baseline I02 trước amendment này.

Yêu cầu người dùng 2026-10-29 bổ sung cho [I01](I01_INGREDIENT_INVENTORY_CONTRACT.md): Admin có đúng sáu mục chính Tổng quan, Đơn hàng, Sản phẩm, Topping, Tồn kho, Nhập hàng. Tồn kho có hai nhóm Vật dụng và Nguyên liệu; Nhập hàng có Vật dụng, Nguyên liệu, Lịch sử nhập hàng. Không thay nghiệp vụ bán hàng/thanh toán.

Vật dụng dùng đơn vị PIECE (cái), số nguyên; nguyên liệu mới dùng L (lít) hoặc KG do Admin chọn. Tận dụng sáu bảng I01: nhóm suy từ đơn vị, không tạo bảng kho thứ hai. Đơn vị G/ML cũ vẫn đọc/nhập/kiểm kê được để bảo toàn dữ liệu lịch sử, không còn dùng khi tạo mặt hàng mới.

Ngưỡng cảnh báo cố định phía server/database: PIECE 10, L 5, KG 10; G/ML lịch sử lần lượt10000/5000 theo đơn vị tương đương. Sắp hết khi 0 < quantity < threshold; bằng threshold còn hàng; bằng 0 hết hàng. Admin không nhập ngưỡng tùy ý. Migration chỉ chuẩn hóa cột ngưỡng và thêm CHECK theo đơn vị, không đổi lượng tồn, version, thời gian cập nhật tồn hoặc chứng từ/audit. Request tạo cũ được replay với key/hash gốc; request mới không được đặt ngưỡng khác.

Tồn sản phẩm bán ra A06 vẫn hoạt động qua mục Sản phẩm → Tồn sản phẩm (`/admin/products/inventory`); menu Tồn kho dùng vật dụng/nguyên liệu. `/admin/ingredients` cũ chuyển về nhóm nguyên liệu của Tồn kho. Quy trình Staff kiểm kê/Admin duyệt, stale/version, atomicity/idempotency và lịch sử I01 được giữ.

Acceptance: đủ sáu menu; hai nhóm kho và ba lựa chọn nhập hàng; form tạo/phiếu nhập chỉ có đúng nhóm/đơn vị; cảnh báo tại0, sát dưới, bằng và trên ngưỡng; phiếu nhập thật cộng kho đúng một lần, lịch sử hai nhóm cùng nguồn dữ liệu; Staff không có quyền nhập kho; kiểm kê cũ không ghi đè sau nhập hàng. Kiểm thử trên PostgreSQL local cô lập và browser; rollout database thật không seed hoặc chỉnh số lượng.

Trạng thái: đã triển khai, kiểm thử và rollout Neon. [Kế hoạch](DEVELOPMENT_PLAN.md).

## Triển khai và vận hành

- `/admin/inventory`: hai lựa chọn Quản lý vật dụng/Quản lý nguyên liệu, tạo mặt hàng, theo dõi lượng tồn/cảnh báo; liên kết nhập bổ sung dẫn sang đúng nhóm của Nhập hàng. Kiểm kê/phê duyệt và lịch sử điều chỉnh vẫn tại Tồn kho.
- `/admin/receipts`: Vật dụng/Nguyên liệu/Lịch sử nhập hàng. Form chỉ chọn mặt hàng thuộc nhóm tương ứng; lịch sử chứa cả hai nhóm, phân trang như I01. Phiếu nháp chưa tăng kho, chỉ xác nhận mới tăng và ghi audit một lần.
- API vẫn dùng namespace `/ingredient-inventory`; không đổi nguồn dữ liệu hoặc phân quyền. `lowStockThreshold` khi tạo mới không bắt buộc, backend tự đặt; giá trị khác chính sách trả400. Request lịch sử có key/hash trùng vẫn replay được. Backend và SQL summary cùng dùng strict `<`.
- A06 tồn sản phẩm giữ source/API và logic; chuyển UI sang `/admin/products/inventory`, truy cập từ trang Sản phẩm. Link cũ `/admin/inventory?productId=...` redirect giữ productId; `/admin/ingredients` chuyển tới `/admin/inventory?category=materials`.

Neon shared development đã áp dụng migration I02. Transaction đối chiếu25 bảng giữ nguyên mọi dữ liệu ngoài cột ngưỡng của ingredients; không thay tồn, version, thời gian, request hash hoặc audit, không thêm mặt hàng/tài khoản thử. Kiểm tra lại báo migration đã hoàn tất và không ghi lần hai. Trên fixture local, thử đủ5 đơn vị kể cả G/ML lịch sử, xác nhận metadata đổi đúng và mọi trường còn lại giữ nguyên; CHECK từ chối ngưỡng sai.

```powershell
npm run db:check:inventory-categories --workspace backend
```

Với database khác còn thiếu migration, dùng quy trình `npm run db:migrate:deploy` hiện có. Khi native Prisma engine bị chặn trên Windows, fallback hẹp chỉ migration I02:

```powershell
npm run db:migrate:inventory-categories --workspace backend
```

Script bắt buộc đầy đủ migration trước đó, kiểm tra checksum/schema, đối chiếu fingerprint và commit/rollback nguyên tử; không reset/seed. `db:check:ingredients` của I01 vẫn hoạt động khi có migration mới hơn.

## Kiểm chứng

Đã chạy: frontend268/268; PostgreSQL55/55 (30 nguyên liệu/vật dụng và25 A06); backend policy5/5; typecheck hai workspace; full frontend lint và lint backend module/script/test liên quan đều PASS. Next production build và backend TypeScript build cô lập trong browser harness đã thành công. Chưa chạy lại toàn bộ backend unit/lint ngoài scope; các lỗi baseline Orders/Cart của đợt I01 vẫn được ghi tại [báo cáo trước](I01_INGREDIENT_INVENTORY_IMPLEMENTATION.md).

Edge headless PASS15 luồng trên hai tài khoản Admin/Staff đăng nhập thật, database PostgreSQL local mới: sáu menu, danh sách rỗng, unit dropdown, lỗi503/timeout/retry, nhập nguyên liệu, duplicate confirm, kiểm kê/approve/reject/recount/stale, reload persistence, tách hai nhóm, nhập vật dụng9→10 và cảnh báo đúng, lịch sử chung, A06 dưới Sản phẩm và Staff bị chặn cả kho/nhập hàng. Ảnh1366/390px không tràn ngang toàn trang, không runtime exception. Evidence cục bộ (ignored): `.brewlite/ingredients-browser-0c25f468e7d74d68a63bcf9e16d78c61/`; database/profile browser thử đã dọn. Không dùng tài khoản/dữ liệu giả thay thế Neon trong ứng dụng.

Sau rà soát ảnh, nhãn bộ lọc được chỉnh theo đúng nhóm vật dụng/nguyên liệu; chạy lại25 kiểm thử render/menu và lint liên quan PASS. Build production cuối trong snapshot riêng dùng API3001 PASS, log `.brewlite/i02-final-build.log`. Kiểm tra Neon READ ONLY không có ngưỡng sai; backend đang chạy `/health` HTTP200. PostgreSQL local riêng đã dừng, backend/frontend của người dùng vẫn hoạt động.

Lệnh chạy kiểm thử database cần PostgreSQL local và `TEST_DATABASE_URL` có tên database kết thúc `_test`; không dùng Neon cho dữ liệu thử. Browser harness tự tạo/xóa database riêng, dùng build snapshot riêng của source, cache frontend theo hash source với API test3101; không ghi đè bản build runtime.

```powershell
npm test --workspace frontend
npm run lint --workspace frontend
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/brewlite_ingredients_test'
npm run test:database --workspace backend -- --runTestsByPath test/database/ingredients.spec.ts test/database/admin-inventory.spec.ts
npm run test:ingredients:browser --workspace frontend
```

## File chính thay đổi

- Backend: [policy](../backend/src/ingredients/ingredient-policy.ts), [DTO](../backend/src/ingredients/ingredient.dto.ts), [service](../backend/src/ingredients/ingredient.service.ts), [migration](../backend/prisma/migrations/20261029150000_inventory_categories/migration.sql), [runner](../backend/scripts/apply-ingredient-inventory.cjs), [scripts](../backend/package.json), [policy tests](../backend/test/ingredient-policy.spec.ts), [database tests](../backend/test/database/ingredients.spec.ts).
- Frontend: [operator shell](../frontend/src/components/operator-shell.tsx), [inventory](../frontend/src/components/ingredient-inventory.tsx), [forms](../frontend/src/components/ingredient-forms.tsx), [API helpers](../frontend/src/lib/api/ingredients.ts), [types](../frontend/src/types/ingredient.ts), [stock page](../frontend/src/app/admin/inventory/page.tsx), [receiving page](../frontend/src/app/admin/receipts/page.tsx), [legacy redirect](../frontend/src/app/admin/ingredients/page.tsx), [products page](../frontend/src/app/admin/products/page.tsx), [product inventory page](../frontend/src/app/admin/products/inventory/page.tsx), [product link](../frontend/src/components/admin-products.tsx).
- Frontend tests: [unit](../frontend/test/ingredients.test.mjs), [navigation](../frontend/test/ui01.test.mjs), [browser](../frontend/test/ingredients-browser.mjs); cập nhật đường dẫn UI A06 trong [inventory browser](../frontend/test/inventory-browser.mjs) và [UI01 browser](../frontend/test/ui01-browser.mjs), không đổi API cũ.
- README và REQUIREMENTS/DECISIONS/ARCHITECTURE/DATABASE_DESIGN/API_DESIGN/PROJECT_STRUCTURE/TRACEABILITY_MATRIX/DEVELOPMENT_PLAN, chú thích superseded trong contract I01. Không sửa PDF, `.env`, payment hoặc order source.
