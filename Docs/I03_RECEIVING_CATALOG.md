# I03 — Danh mục nhập hàng và đơn vị quả

Yêu cầu người dùng2026-10-29 bổ sung cho [I02](I02_INVENTORY_CATEGORIES.md). Chỉ cập nhật danh mục kho/nhập hàng và đơn vị; không sửa PDF, nghiệp vụ sản phẩm, đơn hàng hoặc thanh toán. Người dùng xác nhận riêng cảnh báo trứng khi còn dưới10 quả.

## Quản lý danh mục trong một file (yêu cầu2026-10-31)

Chỉ sửa mảng `ingredientCatalog` trong [ingredient-catalog.ts](../backend/src/ingredients/ingredient-catalog.ts). File này quyết định vật tư hiển thị ở danh sách kho, phiếu nhập và phiếu kiểm kê mới. Bảng12 mặt hàng bên dưới là danh sách ban đầu của I03, không phải một cấu hình thứ hai cần chỉnh theo.

```ts
{ name: "Khăn giấy", unit: "PIECE" }, // Thêm mặt hàng mới.
{ name: "Ly nhựa", unit: "PIECE", label: "Ly nhựa kèm nắp" }, // Đổi tên hiển thị.
```

- Thêm: thêm dòng có `name` duy nhất và `unit` PIECE/L/KG/EGG. Sau khi backend nhận bản sửa, Admin mở hoặc bấm Tải lại dữ liệu ở kho/nhập hàng; initializer tạo mặt hàng còn thiếu với tồn0 và đúng actor. Lượng tồn thực tế vẫn phải nhập qua phiếu/kiểm kê.
- Bỏ: xóa dòng khỏi mảng. Backend đánh dấu `isListed:false` cho bản ghi ngoài danh mục; frontend ẩn khỏi kho và lựa chọn phiếu mới. Không xóa bản ghi, tồn, phiếu hoặc audit trong database. Thêm lại cùng `name`/`unit` sẽ dùng lại tồn và ID cũ. Danh mục rỗng hợp lệ và không tạo/xóa dữ liệu.
- Đổi tên hiển thị: thêm/sửa `label`, giữ `name`/`unit`. Không đổi ID, tồn hoặc tên gốc trên chứng từ cũ. Đổi `name` được hiểu là một mặt hàng khác; không đổi `unit` của hàng đã lưu vì không có quy tắc quy đổi tồn tự động.
- File được backend biên dịch, không cần import vào frontend. Với `nest start --watch`, lưu file sẽ biên dịch lại; launcher root `npm run dev` dùng bản build nên cần build/restart backend theo quy trình chạy hiện có. Khi triển khai thay đổi code lần này phải build lại frontend nữa. Không cần migration hoặc seed.
- Form tạo mặt hàng thủ công không còn hiển thị trên trang kho để danh mục tập trung trong file. API tạo cũ vẫn giữ tương thích; mặt hàng tạo ngoài file sẽ chưa được liệt kê cho phiếu mới. `name`/`unit` là định danh ghép để so khớp kho; kiểm tra tên/nhãn không rỗng, tối đa120 ký tự, tên chuẩn hóa không trùng. Cấu hình sai trả lỗi503 theo envelope hiện có, không giả danh mục rỗng.
- API danh sách vẫn trả đầy đủ bản ghi kèm `isListed` và `displayName` để kiểm kê lại chứng từ cũ dùng được mặt hàng đã bỏ. Tổng mặt hàng/sắp hết/hết hàng trên UI tính từ các bản ghi `isListed` còn hiệu lực; pendingCounts và giới hạn phân quyền vẫn lấy từ server. Lịch sử/phiếu cũ giữ tên gốc. Không chặn receipt/count API cho bản ghi cũ hoặc hủy phiếu nháp tự động.

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

- Yêu cầu ẩn “Ly và nắp nhựa” và “sữa (lít)”2026-10-30 nay được thực hiện bằng danh mục tập trung: hai tên này không nằm trong file, backend trả `isListed:false`; frontend không còn điều kiện riêng theo tên. Quy tắc áp dụng cho mọi mặt hàng bị bỏ khỏi file, không chỉ hai tên này.
- Nguồn danh mục duy nhất: [ingredient-catalog.ts](../backend/src/ingredients/ingredient-catalog.ts). Admin mở/tải lại trang kho hoặc nhập hàng sẽ gọi POST `/ingredient-inventory/catalog/initialize` qua JWT đang đăng nhập, rồi đọc danh sách/thống kê/phiếu từ database thật. Không thay lỗi bằng dữ liệu giả ở frontend.
- Endpoint chỉ Admin, body/query rỗng,200 `{created,existing}`; không cần Idempotency-Key vì thao tác cố định bảo đảm tồn tại danh mục. Dùng transaction, normalizedName unique, createMany skipDuplicates và đối chiếu lại các tên/đơn vị trong file (ban đầu12). Chạy lại không tạo trùng hoặc tăng tồn. Người tạo mặt hàng mới là Admin thực sự gửi request, không giả danh tài khoản khi deploy.
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

Amendment danh mục một file2026-10-31 đã kiểm chứng:

- Frontend ingredients22/22 PASS; backend catalog+policy13/13 PASS. Kiểm tra cấu hình trùng/rỗng/sai đơn vị, thêm mặt hàng, label không ghi vào DB, bỏ/thêm lại giữ tồn/ID, lựa chọn mặc định hợp lệ, thống kê và recount hàng đã bỏ.
- PostgreSQL local cô lập35/35 PASS: gồm HTTP DTO `isListed`/`displayName`, bỏ toàn bộ danh mục trả0/0, thêm lại không tạo trùng hoặc sửa kho/audit, cùng hồi quy nhập/kiểm kê/duyệt/quyền/idempotency. Có cảnh báo `pg` query concurrency trong suite và log lỗi dự kiến của các nhánh fault/constraint; không thay hạ tầng test trong task này.
- Frontend TypeScript và backend `tsconfig.build.json` noEmit PASS; lint toàn bộ source/test thay đổi PASS. Backend TypeScript build cô lập và Next production build PASS. Next build cần chạy ngoài giới hạn spawn của sandbox sau lỗi EPERM ban đầu.
- Edge headless17 luồng PASS trên Nest/PostgreSQL local riêng: Admin khởi tạo danh mục, không còn form thêm thủ công, bản ghi ngoài file vẫn nằm trong DB/API nhưng không xuất hiện trong kho/ô chọn/total UI; nhập vật dụng/nguyên liệu, trứng nguyên quả, Staff kiểm kê/Admin duyệt/recount/stale/reject và reload giữ tồn. Không runtime exception hoặc tràn ngang ở1366/390px.
- Evidence ignored: `.brewlite/ingredients-browser-6b9355740cbe4c19a8b11ba73414de6b/` có result.json, ảnh và build/server logs. Backend build riêng `.brewlite/catalog-file-backend-20261031/`; frontend API3001 tại `.brewlite/builds/2ce758bda84e637d47ba/`. Browser dùng build API3101 riêng. Chỉ tạo/ghi database test localhost; không migration/seed hoặc ghi Neon, không restart runtime người dùng.
- Kiểm tra diff và liên kết mới trong tài liệu. README có2 link lịch sử tới `.env.example` không tồn tại từ trước; không thêm hoặc sửa các link đó trong task này. Không chạy lại toàn bộ backend/frontend suite ngoài phạm vi trên.

Điều chỉnh lựa chọn phiếu nhập2026-10-30 (đã chạy lại sau khi ẩn thêm sữa L): `node --test --test-isolation=none frontend/test/ingredients.test.mjs` PASS19/19; dùng isolation none vì sandbox chặn spawn child process (`EPERM`) ở lệnh test mặc định. `npm.cmd run typecheck --workspace frontend` và ESLint cho `src/components/ingredient-forms.tsx` chạy từ frontend PASS. Render ReceiptForm trực tiếp xác nhận loại hai option cũ kể cả tên hoa/thường/khoảng trắng hai đầu, mặc định chọn mặt hàng hợp lệ, giữ Ly nhựa/Sữa tươi/Sữa đặc và mặt hàng khác, không ẩn tên sữa ở đơn vị khác L, không sửa input và khóa form khi chỉ còn mặt hàng bị ẩn. Không ghi database hoặc chạy browser/build/runtime trong điều chỉnh này; các bằng chứng rollout/E2E bên dưới thuộc đợt I03 trước.

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
