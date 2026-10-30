# I03 — Danh mục nhập hàng và đơn vị quả

Yêu cầu người dùng2026-10-29 bổ sung cho [I02](I02_INVENTORY_CATEGORIES.md). Chỉ cập nhật danh mục kho/nhập hàng và đơn vị; không sửa PDF, nghiệp vụ sản phẩm, đơn hàng hoặc thanh toán. Người dùng xác nhận riêng cảnh báo trứng khi còn dưới10 quả.

| Nhóm | Mặt hàng | Đơn vị |
| --- | --- | --- |
| Vật dụng | Thìa nhựa | Cái (PIECE) |
| Vật dụng | Ly nhựa | Cái (PIECE) |
| Vật dụng | Ống hút | Cái (PIECE) |
| Nguyên liệu | Bột phô mai | Kg |
| Nguyên liệu | Trứng | Quả (EGG) |
| Nguyên liệu | Bột ca cao | Kg |
| Nguyên liệu | Bột màu thực phẩm | Kg |
| Nguyên liệu | Thạch dừa | Kg |
| Nguyên liệu | Phô mai viên | Kg |
| Nguyên liệu | Sữa đặc | Lít |
| Nguyên liệu | Sữa tươi | Lít |
| Nguyên liệu | Đường | Kg |

## Tích hợp

- Nguồn danh mục duy nhất: [ingredient-catalog.ts](../backend/src/ingredients/ingredient-catalog.ts). Admin mở/tải lại trang kho hoặc nhập hàng sẽ gọi POST `/ingredient-inventory/catalog/initialize` qua JWT đang đăng nhập, rồi đọc danh sách/thống kê/phiếu từ database thật. Không thay lỗi bằng dữ liệu giả ở frontend.
- Endpoint chỉ Admin, body/query rỗng,200 `{created,existing}`; không cần Idempotency-Key vì thao tác cố định bảo đảm tồn tại danh mục. Dùng transaction, normalizedName unique, createMany skipDuplicates và đối chiếu lại cả12 tên/đơn vị. Chạy lại không tạo trùng hoặc tăng tồn. Người tạo mặt hàng mới là Admin thực sự gửi request, không giả danh tài khoản khi deploy.
- Mặt hàng còn thiếu tạo với quantity0/version0; số lượng thực tế chỉ nhập qua phiếu xác nhận hoặc kiểm kê được duyệt. Mặt hàng đã có cùng tên chuẩn hóa và cùng đơn vị được dùng lại nguyên trạng, kể cả name/quantity/version/timestamps/request hash/actor. Không xóa mặt hàng ngoài danh mục hoặc lịch sử cũ. Nếu tên đã có nhưng đơn vị khác, trả409 `INGREDIENT_UNIT_MISMATCH` và rollback toàn bộ; không tự chuyển đổi số lượng.
- Enum IngredientUnit thêm EGG. EGG thuộc nhóm nguyên liệu, label quả; cả PIECE và EGG bắt buộc số nguyên ở form, API và ràng buộc lượng tồn DB. Ngưỡng EGG10, LOW_STOCK khi0<quantity<10;10 còn hàng,0 hết hàng. Các ngưỡng lít5/kg10/cái10 giữ nguyên.
- Khi khởi tạo danh mục lỗi, UI vẫn đọc các dữ liệu có sẵn, hiện lỗi và cho tải lại; Staff không gửi request khởi tạo. Giữ timeout, chống lặp nhập/duyệt, kiểm tra stale và audit I01/I02.

## Schema và rollout

[Migration](../backend/prisma/migrations/20261029170000_inventory_egg_unit/migration.sql) chỉ thêm enum/check constraints, không cập nhật dòng nghiệp vụ. CASE dùng `unit::text` để không đọc enum EGG mới ngay trong transaction thêm enum. `ingredients_countable_units` bảo đảm lượng cái/quả nguyên; threshold EGG10 được bảo vệ trong CHECK chung. Không đổi các quan hệ/FK hoặc xóa audit.

Ưu tiên quy trình migrate deploy hiện có. Fallback Windows hẹp, có kiểm tra chain/checksum/schema và fingerprint toàn bộ bảng:

```powershell
npm run db:check:inventory-catalog --workspace backend
npm run db:migrate:inventory-catalog --workspace backend
npm run db:generate --workspace backend
```

Migration không seed dữ liệu/tài khoản. Danh mục nghiệp vụ do người dùng chỉ định được lưu bằng POST có xác thực khi Admin mở trang, ghi đúng người tạo. Tại lần kiểm tra trước triển khai, Neon có `sữa (L)` và `đường (KG)`; giữ sữa cũ, dùng lại đường, không đoán số lượng để chia sữa sang sữa đặc/tươi.

## Kiểm chứng

Acceptance: đúng12 tên/đơn vị,3 vật dụng/9 nguyên liệu; retry và Admin khác không nhân đôi, giữ kho cũ; mismatch không overwrite; Staff/Customer/guest bị chặn khởi tạo; trứng không nhận số lẻ; nhập12 quả→Staff đếm9→Admin duyệt→tồn9 cảnh báo, reload giữ nguyên; lịch sử/audit/stale/duplicate của I01/I02 vẫn chạy.

Hoàn tất2026-10-30. Migration Neon đã commit, đối chiếu25 bảng giữ nguyên mọi dòng dữ liệu; chạy check lại xác nhận I03 đã áp dụng. Lần deploy bị ngắt trước đó chưa thực thi vì automatic approval review hết hạn mức; khi người dùng yêu cầu tiếp tục, kiểm tra lại trạng thái pending rồi mới apply. Không reset/seed hoặc nhập số lượng thử lên Neon.

Kết quả thực tế:

- PostgreSQL59/59 PASS:34 nguyên liệu/danh mục/trứng và25 hồi quy A06; kiểm tra quyền, replay, rollback, stale, số nguyên và ngưỡng10. Lượt nhiều suite có cảnh báo worker không thoát graceful và cảnh báo `pg` query concurrency; chưa xử lý các cảnh báo hạ tầng test này trong phạm vi danh mục.
- Frontend269/269 PASS; policy backend7/7 PASS; typecheck hai workspace, full frontend lint và focused backend lint PASS.
- Nest backend build và Next production build PASS. Bản frontend chạy API3001 dùng snapshot riêng, không dùng cấu hình test3101; log `.brewlite/i03-final-build.log`.
- Edge headless17/17 luồng PASS, Admin/Staff đăng nhập thật trên PostgreSQL local cô lập. Kiểm tra đủ12 tên/đơn vị từ DB, nhập trứng nguyên quả, từ chối1,5 quả, kiểm kê12→9/duyệt/cảnh báo/reload và không nhân đôi danh mục. Các nhánh nhập lặp, lỗi503/timeout/retry, quyền, stale/recount/reject và A06 vẫn PASS. Không runtime exception hoặc tràn ngang toàn trang ở1366/390px.
- Evidence ignored: `.brewlite/ingredients-browser-59d41404752d464aaa0763c82dc54f3d/`, gồm result.json, build logs, ảnh kho/nhập hàng/trứng/Staff. Database/profile browser test đã dọn. Không thay các bộ kiểm thử này bằng ghi dữ liệu giả vào Neon.
- Runtime thật: `/health`, `/products`, `/login`, `/admin/receipts`, `/admin/inventory` HTTP200; ingredients và catalog initialize không đăng nhập HTTP401. Cổng3000/3001 ban đầu không có server, đã khởi động bản build mới với nguyên cấu hình `.env`; PID/log riêng tại `.brewlite/i03-app-pids.json` và `i03-*.log`.

Chưa chạy lại toàn bộ backend unit/lint ngoài scope; lỗi baseline Orders/Cart của đợt I01 vẫn được ghi trong [báo cáo trước](I01_INGREDIENT_INVENTORY_IMPLEMENTATION.md). [Kế hoạch](DEVELOPMENT_PLAN.md).

## File thay đổi

- Backend: [catalog](../backend/src/ingredients/ingredient-catalog.ts), [schema](../backend/prisma/schema.prisma), [migration](../backend/prisma/migrations/20261029170000_inventory_egg_unit/migration.sql), [policy](../backend/src/ingredients/ingredient-policy.ts), [DTO](../backend/src/ingredients/ingredient.dto.ts), [service](../backend/src/ingredients/ingredient.service.ts), [controller](../backend/src/ingredients/ingredient.controller.ts), [runner](../backend/scripts/apply-ingredient-inventory.cjs), [package scripts](../backend/package.json).
- Frontend: [types](../frontend/src/types/ingredient.ts), [API helpers](../frontend/src/lib/api/ingredients.ts), [forms](../frontend/src/components/ingredient-forms.tsx), [load/catalog initialization](../frontend/src/components/ingredient-inventory.tsx).
- Tests: [backend policy](../backend/test/ingredient-policy.spec.ts), [PostgreSQL](../backend/test/database/ingredients.spec.ts), [frontend](../frontend/test/ingredients.test.mjs), [browser](../frontend/test/ingredients-browser.mjs).
- README, REQUIREMENTS, DECISIONS, DATABASE_DESIGN, API_DESIGN, ARCHITECTURE, PROJECT_STRUCTURE, TRACEABILITY_MATRIX, DEVELOPMENT_PLAN và tài liệu hiện tại. Không sửa `.env`, PDF, order/payment/auth source.
