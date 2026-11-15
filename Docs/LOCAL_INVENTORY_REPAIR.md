# Sửa lỗi tải kho và nhập hàng trên localhost — 2026-11-12

## Phạm vi và nguyên nhân

Người dùng giao sửa lỗi xuất hiện trên cả `/admin/inventory` và `/admin/receipts`: “Có cập nhật đồng thời… Thống kê: Chưa tải được dữ liệu”. Đây là sửa lỗi triển khai I01/I03–I06, không thêm yêu cầu PDF hoặc thay chính sách nhập/kiểm kê.

Database development hiện dùng cột ID/FK `TEXT`, trong khi schema repository dùng UUID. Truy vấn khóa User và thống kê so sánh TEXT với tham số ép `::uuid`, gây PostgreSQL `42883: operator does not exist: text = uuid`. Hai trang cùng gọi initializer và tải các phần kho; initializer thất bại bị quy mọi lỗi Prisma `P2010` thành `409 CONCURRENT_UPDATE`, còn thống kê trả `503 SERVICE_UNAVAILABLE`.

Tại lúc kiểm tra, bảng `ingredients` có0 dòng. Khởi tạo danh mục bị lỗi ngay trước bước tạo mặt hàng, nên danh mục chưa được bổ sung.

## Cách sửa và bảo toàn dữ liệu

- Trong `IngredientService`, so sánh ID/FK dưới dạng `::text` khi khóa actor, nguyên liệu, chứng từ, lọc phiếu chờ duyệt và cập nhật tồn theo phiên bản. Hỗ trợ cả cột UUID của migration chuẩn và TEXT hiện có; vẫn dùng tham số SQL, `FOR UPDATE`, thứ tự khóa, CAS, transaction và lịch sử trước/sau.
- Chỉ nhận diện contention qua Prisma `P2002/P2028/P2034` hoặc SQLSTATE `55P03/57014/40P01/40001`, đọc cả metadata trực tiếp và driver adapter. Lỗi SQL khác trả503 đã làm sạch, không báo sai rằng có người cập nhật đồng thời.
- Không đổi schema/migration, DTO/path, quyền, version, idempotency, ngưỡng I06, số lượng tồn đã có hoặc helper của Order/Payment. Ingredient/document IDs ở HTTP tiếp tục yêu cầu UUID.
- Chạy initializer Admin hiện có sau sửa: thêm14 mặt hàng được cấu hình, gồm5 vật dụng và9 nguyên liệu, đều tồn0. Lần gọi tiếp theo tạo0, giữ14 dòng. Không seed/reset hoặc tự nhập hàng; đây là bổ sung danh mục, không khôi phục lượng tồn quá khứ chưa có nguồn đối chiếu.

## Acceptance và bằng chứng

1. Backend unit:39/39 qua `ingredient-errors`, `ingredient-catalog`, `ingredient-policy`. Lỗi SQL không phải contention trả503; lỗi khóa/transaction được nhận diện vẫn trả409; business error giữ nguyên và không lộ chi tiết database.
2. PostgreSQL local riêng:54/54 qua `ingredients.spec.ts` và `ingredient-storage.spec.ts`. Bộ mới chạy trên cả schema UUID và TEXT, có actor ID số cũ; kiểm tra summary rỗng, initializer không lặp, giữ tồn có sẵn, xác nhận phiếu đúng một lần, giới hạn phiếu Staff theo owner, chặn kiểm kê cũ và replay duyệt kiểm kê. Bộ hiện có kiểm tra quyền, cạnh tranh, nhiều dòng và rollback tồn/journal. Fixture TEXT chỉ chuyển kiểu trong schema local kiểm thử và phục hồi đầy đủ FK/CHECK; cluster riêng đã dừng sau kiểm thử.
3. TypeScript toàn backend, ESLint các file sửa/thêm và build backend vào thư mục cô lập đều PASS.
4. Runtime development: Admin đọc ingredients/summary/receipts/counts/movements200; Staff đọc ingredients/summary/counts200, initializer/receipts403. Thống kê14 mặt hàng,14 hết hàng,0 phiếu chờ duyệt. Đối chiếu snapshot các bảng User/catalog/Order/Payment/Loyalty/Cart và chứng từ kho trước/sau giữ nguyên; các dòng danh mục mới có tồn0.
5. Edge với hồ sơ riêng: đăng nhập Admin, hai trang tải đủ thống kê/danh mục,5 vật dụng và9 nguyên liệu ở đúng nhóm, không còn banner lỗi; F5 cả hai trang vẫn tải thành công,0 JavaScript runtime exception; đã đăng xuất và đóng browser kiểm thử.

Bằng chứng local, không commit: `.brewlite/inventory-id-unit.log`, `inventory-id-database.log`, `inventory-id-typecheck.log`, `inventory-id-build.log`, `inventory-id-live-result.json`, `inventory-id-browser-result.json`, `inventory-stock-fixed.png`, `inventory-receipts-fixed.png`.

Lệnh unit chạy từ `backend/`: `node ../node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/ingredient-errors.spec.ts test/ingredient-catalog.spec.ts test/ingredient-policy.spec.ts`, với `NODE_ENV=test`. Database suites cần `TEST_DATABASE_URL` trỏ database local riêng có tên kết thúc `_test`; tuyệt đối không dùng database development dùng chung. Không chạy full backend/frontend suite, full frontend build hoặc VNPAY trong đợt sửa này; frontend không thay đổi. Không suy rộng hỗ trợ TEXT cho mọi truy vấn ngoài module nguyên liệu.
