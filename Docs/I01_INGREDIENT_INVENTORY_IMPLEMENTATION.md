# I01 — Triển khai và sửa lỗi nguyên liệu, kiểm kê

Ngày kiểm chứng: 2026-10-29. Phạm vi là yêu cầu bổ sung của người dùng, tách biệt PDF baseline và A06 tồn sản phẩm. [Contract](I01_INGREDIENT_INVENTORY_CONTRACT.md), [database](DATABASE_DESIGN.md), [API](API_DESIGN.md).

## Nguyên nhân và cách sửa

1. Database Neon đang được `.env` sử dụng chưa áp dụng migration `20261029100000_ingredient_inventory`: cả sáu bảng nguyên liệu đều chưa tồn tại. Backend không thể đọc danh sách/phiếu. Đã áp dụng migration bổ sung trong transaction; đối chiếu fingerprint dữ liệu của 19 bảng nghiệp vụ cũ trước/sau không đổi. Lần kiểm tra sau xác nhận migration hoàn tất và đủ sáu bảng. Không reset database, không seed nguyên liệu hoặc tài khoản thử vào Neon.
2. Frontend trước đó gom tất cả request trong `Promise.all`; một lỗi ở phiếu/lịch sử làm mất cả kết quả danh sách. Đã thay bằng tải độc lập và `Promise.allSettled`, cập nhật từng phần ngay khi thành công, báo lỗi đúng phần thất bại. Danh sách trống hợp lệ vẫn hiển thị form thêm nguyên liệu cho Admin. Không dùng dữ liệu mẫu hoặc số 0 để che lỗi đọc thống kê.
3. Request có thời hạn 12 giây; mọi nhánh tải/gửi/tải thêm giải phóng loading trong `finally`. Có nút tải lại. Với mutation chưa rõ kết quả, giữ nguyên key và payload để kiểm tra lại thay vì tạo phiếu mới.
4. Thêm endpoint aggregate summary từ database thật: tổng nguyên liệu, còn hàng, sắp hết, hết hàng và phiếu chờ duyệt. Số phiếu không bị giới hạn bởi trang lịch sử đầu tiên; Staff chỉ thấy số phiếu của mình.
5. Trong lần kiểm tra môi trường chạy, tiến trình Nest watch còn tồn tại nhưng backend không còn lắng nghe cổng 3001. Đã kích hoạt biên dịch lại, khôi phục backend; nội dung source sau thao tác giữ nguyên. Bộ kiểm thử trình duyệt dùng thư mục build backend/frontend riêng để không ghi đè bản build của ứng dụng đang chạy.

## Chức năng đã triển khai

- Admin `/admin/ingredients`: danh sách, lọc trạng thái, bốn thẻ thống kê, thêm nguyên liệu, phiếu nhập nháp/xác nhận, duyệt/từ chối/yêu cầu kiểm kê lại và lịch sử trước/sau/người thực hiện/thời gian.
- Staff `/operator/ingredients`: xem lượng tồn theo kg/g/lít/ml/cái; chọn nguyên liệu, nhập thực đếm, chênh lệch tự tính, ghi chú, gửi phiếu và theo dõi lịch sử/trạng thái. Kiểm kê lại tạo phiếu mới liên kết bản cũ.
- Backend dùng JWT và current database role hiện có. Staff không có API sửa tồn, không được xem phiếu Staff khác hoặc dùng thao tác Admin. Dữ liệu đồng bộ qua PostgreSQL, không lưu kho chính thức ở trình duyệt.
- Decimal ba chữ số lẻ, đơn vị cái phải nguyên. Giao diện nhận dấu phẩy thập phân, API dùng chuỗi chính xác. Admin chọn ngưỡng sắp hết; tồn mới bằng 0 và được tăng bằng phiếu nhập có lịch sử.
- Confirm/approval là transaction có khóa và kiểm tra version; audit append-only và unique source line. Duyệt/xác nhận lặp không áp dụng lần hai. Nếu có nhập hàng hoặc duyệt khác làm đổi version, phiếu cũ trả `409 INVENTORY_CHANGED`, không ghi đè kho mới; Admin yêu cầu kiểm kê lại.
- Không thêm trừ theo công thức, quản lý nhà cung cấp hoặc thay Product.stock/Order/Payment/auth. Giao diện dùng shell/theme BrewLite; bảng trên màn hình hẹp cuộn trong vùng bảng.

## Kết quả kiểm chứng

| Kiểm tra | Kết quả và giới hạn |
| --- | --- |
| PostgreSQL HTTP/integration nguyên liệu + A06 | 51/51 PASS: 26 nguyên liệu và 25 tồn sản phẩm cũ; quyền, ownership, decimal, replay, giao dịch đồng thời, stale, nhiều dòng rollback và audit bất biến |
| Backend policy + provisioning | 9/9 PASS; 3 kiểm thử chính sách nguyên liệu và 6 kiểm thử provisioning cũ |
| Frontend toàn bộ | 266/266 PASS, bao gồm 16 kiểm thử nguyên liệu; không bỏ qua test |
| Edge headless + Nest + PostgreSQL local | 12/12 luồng PASS, tài khoản Admin/Staff đăng nhập thật qua UI; quy trình đầy đủ, 503, timeout, retry, reload, quyền và kích thước 1366/390px |
| Build | Nest build PASS; backend TypeScript build riêng cho browser PASS; Next production build `--webpack` PASS, có cả hai route nguyên liệu |
| Typecheck/lint | Backend/frontend typecheck PASS; frontend full lint PASS; lint module/script/test nguyên liệu backend PASS |
| Neon thật | Migration đã áp dụng, đủ sáu bảng, đọc service trong READ ONLY thành công; tại thời điểm kiểm tra có 0 nguyên liệu thật, các thống kê đều 0. Không thêm dữ liệu demo |
| HTTP môi trường đang chạy | `/health`, `/products`, hai trang nguyên liệu HTTP200; API nguyên liệu/summary không đăng nhập trả401 đúng contract |

Kiểm thử browser thực hiện: Admin thêm sữa → tạo phiếu nháp (tồn vẫn 0) → xác nhận nhiều lần (tồn 10, một biến động) → Staff kiểm kê 8,25 và ghi chú (tồn chính thức vẫn 10) → Admin duyệt (8,25) → nhập thêm 5 làm phiếu kiểm kê đang chờ bị stale → chặn duyệt cũ → yêu cầu kiểm kê lại → Staff lập phiếu mới 12,5 → Admin duyệt → từ chối phiếu khác không đổi tồn → reload vẫn 12,500 trong PostgreSQL. Audit đúng bốn biến động, có actor/time/before/after. Không có runtime exception hoặc tràn ngang toàn trang.

Các tài khoản và dữ liệu kiểm thử chỉ nằm trong PostgreSQL local có tên `_test`, schema/database ngẫu nhiên được dọn sau chạy. Vì không ghi dữ liệu giả vào Neon, thao tác đăng nhập và ghi end-to-end hai vai trò được kiểm chứng trên database local thực; Neon chỉ rollout schema và kiểm tra đọc. Đây không phải chứng nhận toàn bộ browser matrix/NFR của dự án.

Lỗi cũ còn tồn tại ngoài phạm vi I01:

- Full backend unit có hai assertion trong `backend/test/operator-orders.spec.ts` chưa cập nhật với DTO thời hạn đơn/server clock. Đã tái hiện cùng hai lỗi với AppModule baseline trước I01 và xác nhận source Orders/test này không đổi.
- Full backend lint báo `backend/test/cart-service.spec.ts:16:32` vi phạm `require-await`. File này không sửa.
- Lần chạy full unit trong sandbox còn lỗi spawn ở provisioning; chạy lại ngoài sandbox đúng bộ `test/provisioning.spec.ts` đã PASS toàn bộ. Không coi đó là lỗi chức năng nguyên liệu.

Evidence browser lưu cục bộ trong `.brewlite/ingredients-browser-<run-id>/`: `result.json`, log build/server và ảnh Admin/Staff ở 1366/390px. Thư mục này bị ignore, không chứa cấu hình Neon hoặc credentials thật. Không đưa database thử hoặc profile Edge vào source.

Bản kiểm chứng cuối PASS cả12 luồng: `.brewlite/ingredients-browser-6ce53492d4414f049330dd57be6c55bc/`. Node24.22.1, PostgreSQL18, Next16.4.3, Edge headless trên Windows. Database/profile browser thử đã dọn; PostgreSQL local do đợt kiểm thử này khởi động đã dừng, không dừng backend/frontend của người dùng.

## Lệnh kiểm chứng và migration

Kiểm tra database hiện dùng, không thay dữ liệu:

```powershell
npm run db:check:ingredients --workspace backend
```

Đối với database khác chưa áp dụng migration: ưu tiên quy trình hiện có `npm run db:migrate:deploy`. Nếu Prisma native engine bị chặn trên máy Windows, fallback chỉ cho I01:

```powershell
npm run db:migrate:ingredients --workspace backend
```

Fallback từ chối migration chain thiếu, schema dở dang hoặc checksum lệch; khóa transaction, đối chiếu dữ liệu cũ và rollback nếu có sai lệch. Gọi lại khi đã hoàn tất không sửa gì. Không dùng `db push`, reset hoặc seed để sửa lỗi tải dữ liệu.

```powershell
npm test --workspace frontend
npm run lint --workspace frontend
cd backend
node ../node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/ingredient-policy.spec.ts test/provisioning.spec.ts
```

Database test yêu cầu PostgreSQL local đang chạy và `TEST_DATABASE_URL` trỏ đến database riêng có tên kết thúc `_test`, không dùng Neon. Thay cổng/database bằng môi trường kiểm thử của máy:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/brewlite_ingredients_test'
npm run test:database --workspace backend -- --runTestsByPath test/database/ingredients.spec.ts test/database/admin-inventory.spec.ts
npm run db:generate --workspace backend
npm run test:ingredients:browser --workspace frontend
```

Browser test cần Edge tại đường dẫn mặc định Windows (hoặc biến `BROWSER_PATH`), hai cổng 3100/3101 trống và quyền tạo database local. Script tự build nguồn hiện tại riêng trong `.brewlite`, tạo/xóa database thử do chính script sở hữu; không ghi đè build runtime hoặc dùng mock API làm dữ liệu kho.

## Danh sách file thêm hoặc sửa

Backend:

- [schema.prisma](../backend/prisma/schema.prisma)
- [migration.sql](../backend/prisma/migrations/20261029100000_ingredient_inventory/migration.sql)
- [app.module.ts](../backend/src/app.module.ts)
- [ingredient.module.ts](../backend/src/ingredients/ingredient.module.ts)
- [ingredient.controller.ts](../backend/src/ingredients/ingredient.controller.ts)
- [ingredient.service.ts](../backend/src/ingredients/ingredient.service.ts)
- [ingredient.dto.ts](../backend/src/ingredients/ingredient.dto.ts)
- [ingredient-policy.ts](../backend/src/ingredients/ingredient-policy.ts)
- [apply-ingredient-inventory.cjs](../backend/scripts/apply-ingredient-inventory.cjs)
- [backend/package.json](../backend/package.json)
- [ingredient-policy.spec.ts](../backend/test/ingredient-policy.spec.ts)
- [database/ingredients.spec.ts](../backend/test/database/ingredients.spec.ts)

Frontend:

- [types/ingredient.ts](../frontend/src/types/ingredient.ts)
- [api/ingredients.ts](../frontend/src/lib/api/ingredients.ts)
- [ingredient-inventory.tsx](../frontend/src/components/ingredient-inventory.tsx)
- [ingredient-forms.tsx](../frontend/src/components/ingredient-forms.tsx)
- [ingredients.css](../frontend/src/app/ingredients.css)
- [Admin page](../frontend/src/app/admin/ingredients/page.tsx)
- [Staff page](../frontend/src/app/operator/ingredients/page.tsx)
- [operator-shell.tsx](../frontend/src/components/operator-shell.tsx)
- [frontend/package.json](../frontend/package.json)
- [ingredients.test.mjs](../frontend/test/ingredients.test.mjs)
- [ingredients-browser.mjs](../frontend/test/ingredients-browser.mjs)

Tài liệu:

- [README](../README.md)
- [REQUIREMENTS](REQUIREMENTS.md)
- [DECISIONS](DECISIONS.md)
- [ARCHITECTURE](ARCHITECTURE.md)
- [DATABASE_DESIGN](DATABASE_DESIGN.md)
- [API_DESIGN](API_DESIGN.md)
- [PROJECT_STRUCTURE](PROJECT_STRUCTURE.md)
- [DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md)
- [TRACEABILITY_MATRIX](TRACEABILITY_MATRIX.md)
- [I01 contract](I01_INGREDIENT_INVENTORY_CONTRACT.md)
- Báo cáo hiện tại `I01_INGREDIENT_INVENTORY_IMPLEMENTATION.md`.
