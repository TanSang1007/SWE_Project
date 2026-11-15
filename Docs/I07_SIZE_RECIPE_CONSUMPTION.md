# I07 — Định lượng, giữ chỗ và tiêu hao nguyên liệu theo size

**Amendment I08,2026-11-13:** [hai quy định và ngoại lệ người dùng chốt](I08_INVENTORY_CONTROL.md) bổ sung nháp/tỷ lệ/đối chiếu journal khi duyệt nguyên liệu; loại đá/vật dụng khỏi chênh lệch. Nước chỉ giữ định lượng tham khảo, không nhập/giữ/trừ/khóa món mới; danh mục đang quản lý còn12 nguyên liệu/6 vật dụng, nước cũ giữ dữ liệu. Chỉ tại chỗ, bỏ mang đi và công thức cảnh báo trung bình/dự phòng; giữ ngưỡng cảnh báo tồn và gateway. Phần I07 bên dưới ghi checkpoint trước amendment.

Người dùng giao áp dụng Size_S.txt/Size_M.txt/Size_L.txt ngày2026-11-12 và đã chọn dùng danh mục mới trong NGUYÊN LIỆU PHA CHẾ.txt, giữ riêng tồn/lịch sử cũ, phần mới bắt đầu từ0; Cold Brew luôn có syrup theo size. Đây là extension thay cơ chế chỉ kiểm tra quantity>0 của I05, không sửa PDF baseline. Triển khai và nghiệm thu tiếp tục ngày2026-11-13.

## Công thức và danh mục

Nguồn: [Size S](../Size_S.txt), [Size M](../Size_M.txt), [Size L](../Size_L.txt), [nguyên liệu/vật dụng](../NGUYÊN%20LIỆU%20PHA%20CHẾ.txt), [quy định còn/hết món](../%23%20QUY%20ĐỊNH%20TRẠNG%20THÁI%20CÒN%20MÓN%20VÀ%20HẾT%20MÓN.md). File kịch bản bán hàng có những mục là đề xuất; không tự áp dụng thời hạn5 phút, hoàn tiền, mang đi hoặc các nghiệp vụ khác ngoài task này.

- `drink-recipes.ts` chứa7 món×3 size, đổi chính xác g→KG, ml→L bằng Decimal. Cold Brew dùng cả cà phê/nước đầu vào để ủ theo file; chưa có quy trình sản xuất nước cốt riêng. Syrup tùy chọn trong nguồn được người dùng chọn luôn dùng: S5ml, M10ml, L15ml.
- Làm rõ đơn vị ngày 2026-11-15 theo yêu cầu người dùng: cả ba file giữ lượng g để pha chế và ghi thêm lượng kg tương đương cho đủ 48 dòng khối lượng. `1 kg = 1000 g`; ví dụ `5 g (0.005 kg)`, `150 g (0.150 kg)`, `18 g (0.018 kg)`. Dấu chấm là dấu thập phân. Các lượng trong ngoặc là cùng một định lượng; giữ cách tính chia 1000 đã đúng trong code, lượng tiêu hao và snapshot đơn cũ. Test đối chiếu 21 công thức đồng thời kiểm tra chú thích kg khớp với g.
- Kem tươi S/M/L20/30/40ml; caramel10/15/20ml khi khách chọn. Tên hiện có Kem/Caramel được ánh xạ tới nguyên liệu tương ứng. Topping chưa có định lượng không được bán kèm món cấu hình; giao diện vô hiệu hóa thay vì tự đoán lượng.
- Có13 nguyên liệu: ba loại cà phê riêng, matcha, cacao, sữa tươi, sữa đặcKG, đường cát, syrup đường, syrup caramel, kem tươi, nước lọc, đáKG; sáu vật dụng theo file. Ly sứ/thủy tinh và các vật dụng tái sử dụng không trừ sau mỗi ly. Không tự thêm bao bì mang đi khi chưa có flow/định lượng.
- Tạo danh mục mới bằng initializer Admin hiện có. Storage name thêm ` (công thức)`, displayName đúng tên trong file; giữ unique normalized_name mà không sửa bất kỳ tên/đơn vị/tồn/audit cũ, kể cả Bột matcha hoặc Sữa đặc trùng tên. Kho/phiếu mới lọc danh mục mới, lịch sử cũ vẫn đọc được. Không gộp cà phê, không coi gam sữa đặc là ml hoặc đổi bao đá sang kg.
- Tồn mới0. Ngưỡng cảnh báo mới dùng chính sách đơn vị sẵn có5L/10KG và10PIECE; nguyên liệu cảnh báo khi khả dụng dương và≤ngưỡng, vật dụng dùng dấu< như cũ. I06 tên/đơn vị/ngưỡng của hàng cũ vẫn được bảo toàn.

## Giao dịch và số lượng

`Ingredient.quantity` là tồn vật lý; `reservedQuantity` là tổng đã giữ; khả dụng bằng quantity−reservedQuantity. CHECK yêu cầu0≤reserved≤quantity. Schema development đã có reserved_quantity từ extension cũ; migration giữ nguyên giá trị, chỉ thêm cột0 khi chưa có.

Bảng mới `order_recipe_ingredients` lưu một snapshot tổng cho mỗi Order×Ingredient: FK, tên/đơn vị/quantity, state RESERVED/RELEASED/CONSUMED, cycle. Không dùng tên sản phẩm hoặc công thức hiện hành để tính lại khi retry/hủy. Bảng `ingredient_reservations` cũ trên development thuộc extension khác, không bị thay thế hoặc sửa.

1. Cart/preview kiểm tra size, topping và tổng nhu cầu của các món dùng chung nguyên liệu. Chưa giữ hàng khi chỉ thêm giỏ.
2. Create Order PENDING: sau owner serialization và Product CAS, khóa nguyên liệu theo id bằng FOR UPDATE, đọc lại số khả dụng, giữ đủ toàn bộ nhu cầu trong cùng transaction với Order/snapshot/idempotency. Thiếu bất kỳ nguyên liệu nào trả409 OUT_OF_STOCK và rollback tất cả; không tự giảm qty/đổi size. Tồn vật lý giữ nguyên, reserved tăng. Replay không giữ lại lần nữa.
3. Payment initiation/confirm-zero của đơn I07 xác nhận phần đã giữ của chính đơn; không đòi thêm nguyên liệu khả dụng, nên ly cuối đã giữ vẫn thanh toán được. Đơn cũ không có snapshot I07 tiếp tục contract cũ.
4. Verified payment failure, hủy unpaid hoặc Admin hủy PAID trước pha: giảm reserved đúng một lần, không cộng vào tồn vật lý. UNKNOWN/REVIEW và callback chưa xác nhận vẫn giữ tài nguyên theo guard tài chính hiện có; không giải phóng chỉ vì đồng hồ hết hạn. Giữ nguyên cửa sổ thanh toán600s.
5. Retry sau failure: kiểm tra và giữ lại đúng snapshot ban đầu, tăng cycle, nguyên tử với claim/attempt/state. Không trừ lại khi cùng key replay. Không đọc công thức mới để thay định lượng của đơn cũ.
6. PAID→PREPARING: giảm đồng thời quantity và reserved theo snapshot một lần, ghi tiêu hao. READY/COMPLETED không trừ thêm. Các cạnh hủy hiện có chỉ cho Admin hủy PAID, không mở thêm hủy sau pha và không hoàn phần đã tiêu hao.
7. Receipt tăng tồn vật lý. Kiểm kê chụp tồn vật lý/version; approve không được đặt quantity thấp hơn reserved. Mọi reserve/release/consume đều tăng Ingredient.version nên phiếu kiểm kê cũ không thể ghi đè giữ chỗ mới.

IngredientMovement thêm nguồn reservation/action/cycle, giữ nguyên constraint của các nguồn cũ kể cả reservation_line_id trên development. CHECK đúng một nguồn và unique event theo snapshot/action/cycle; nhật ký append-only. RESERVE/RELEASE có delta vật lý0, CONSUME có delta âm; response bổ sung committedQuantity để thấy lượng giữ/giải phóng. Actor theo JWT ở create/cancel/prepare/Admin paid-cancel; verified callback được gắn tài khoản chủ đơn theo ngữ cảnh hệ thống.

## API và giao diện

Giữ nguyên path/DTO input/quyền/error envelope. Không cho client gửi định lượng hoặc snapshot.

- Public Product thêm stockStatus; detail mỗi size thêm available/maxQuantity/stockStatus. Topping thêm availableSizes. Số ly là min(floor(khả dụng/định lượng)) của các nguyên liệu, theo từng size. Trên10 IN_STOCK,1–10 LOW_STOCK,0 OUT_OF_STOCK. Product available khi ít nhất một size đang kinh doanh đủ nguyên liệu.
- Cart.stock cho món có công thức nay là số ly thực tế của cấu hình size/topping; requestedQuantity là qty của cấu hình. Pricing/create kiểm tra tổng nhu cầu nhiều cấu hình, không chỉ từng dòng. Đơn cũ/unconfigured tiếp tục Product.stock; ingredientKeysSnapshot rỗng vẫn là marker tồn món cũ, key i07 có prefix riêng.
- Admin product inventory thêm sizes với số ly/trạng thái. Kho nguyên liệu trả reservedQuantity/availableQuantity cùng quantity vật lý. Theo yêu cầu người dùng ngày2026-11-15, bảng kho dùng chung cho Admin/Staff bỏ cột “Đã giữ”, hiển thị “Tồn thực tế” và “Có thể bán”; cơ chế giữ/release/consume và cách tính khả dụng vẫn giữ nguyên. GET movements có ORDER_RESERVE/ORDER_RELEASE/ORDER_CONSUME và documentId của đơn, committedQuantity; nguồn cũ chưa được map giữ LEGACY thay vì làm lỗi cả lịch sử.
- Chọn size/topping không đủ bị khóa; giỏ/checkout vẫn kiểm tra server lần cuối. Menu/chi tiết tự đọc lại mỗi20s và khi cửa sổ nhận focus, giữ lựa chọn đang sửa. Trang tồn kho tự tải lại ở tab danh sách mỗi20s/focus; không tự reset form nhập hàng/kiểm kê đang điền. Đây không phải cập nhật realtime qua websocket.

## Migration và bảo toàn

[Migration additive](../backend/prisma/migrations/20261112150000_size_recipe_reservations/migration.sql), [runner có fingerprint](../backend/scripts/apply-size-recipes.cjs). Runner chỉ development/test được chỉ định; đọc/checksum ledger, advisory lock, kiểm tra nguồn inventory, transaction và đối chiếu mọi bảng cũ. FK của bảng mới theo kiểu UUID/TEXT thực tế; baseline Prisma vẫn UUID. Không sửa ledger migration khác, tài khoản, giá, số tiền, trạng thái thanh toán hoặc tồn cũ.

Đã áp dụng migration lên development: fingerprint33 bảng cũ giữ nguyên, bảng snapshot mới rỗng. Prisma generate thành công. Initializer Admin tạo19 mục mới tồn0, chạy lại created0/existing19;21 dòng kho cũ và dữ liệu nghiệp vụ giữ nguyên. Admin đọc ingredients/summary/receipts/counts/movements200; Staff đọc trong quyền200, thao tác hạn chế403; public đủ7 món với3 size. Những truy vấn khóa User/Product/Topping/Order/Attempt/Verification trong luồng này so sánh id::text để tương thích development TEXT; giữ nguyên validation UUID tại HTTP và ownership/role checks. Không tự coi đây là đồng bộ toàn bộ schema development với repository.

## Kiểm chứng

Nghiệm thu ngày2026-11-13:

| Kiểm tra | Kết quả và evidence local |
| --- | --- |
| Backend unit/HTTP liên quan |256/256,11 suite; `recipe-size-backend-final.log` |
| PostgreSQL local |128/128,4 suite; `recipe-size-regressions.log`. I07 có60 kiểm tra: mỗi schema UUID/TEXT30, đối chiếu21 công thức, topping, cộng nhu cầu, tranh ly cuối, failure/retry snapshot, cancel/preparing/replay, rollback journal và kiểm kê cũ |
| Frontend |280/280; `recipe-size-frontend-tests.log` |
| Static/build |Hai workspace typecheck, backend lint, browser harness lint, Prisma validate/generate, backend build và Next production build cô lập đạt. Frontend lint0 lỗi, còn một cảnh báo logo `<img>` đã có trước trong menu.tsx |
| Edge/Nest/PostgreSQL thật |7 nhóm kiểm tra đạt,0 runtime exception; `.brewlite/size-recipes-browser-5b2391748d3045c6bc9d278a5aa6e510/result.json`, ảnh kho/lịch sử390/1366px. Sữa200ml chỉ bán S; tạo/hủy cập nhật availability;1S+2M giữ590ml sữa và60ml kem; Staff bắt đầu pha tiêu hao đúng một lần; Admin xem tồn/lịch sử |
| Development |`recipe-size-migration.log`, `recipe-size-live-result.json`: bảo toàn33 bảng cũ khi migrate,21 dòng kho khi initialize,19 mục mới tồn0, replay initializer không trùng, API/quyền/catalog như trên |

Evidence `.brewlite/` được gitignore, không chứa credential thật trong report. Các database integration và browser chạy trên PostgreSQL local riêng, dùng mật khẩu/khóa synthetic; browser dùng guard initiation test có kiểm soát và confirm-zero nội bộ, không gọi gateway. Tài nguyên local được tự dọn khi kết thúc. Development chỉ migration additive, khởi tạo danh mục và kiểm tra API/quyền; không nhập tồn giả hoặc tạo giao dịch tài chính thử.

Chưa chạy full backend suite, Firefox, VNPAY thật hoặc toàn bộ acceptance B17–B19. Hướng dẫn chạy: Jest database với TEST_DATABASE_URL local `_test`, hoặc `npm.cmd run test:recipes:browser --workspace frontend` với cùng điều kiện và Edge đã cài; browser dùng3100/3101 và tự tạo/xóa database test riêng. Kết quả được ghi cùng checklist trong [kế hoạch phát triển](DEVELOPMENT_PLAN.md).
