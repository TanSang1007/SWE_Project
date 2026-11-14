# Bản sửa giỏ hàng/tính giá không migration — 2026-11-02

Base main635c9b2. Thay thế gói BrewLite-cart-pricing-fix.zip trước đó nếu chưa áp dụng. Không cần chạy migration, db push, reset hoặc seed. schema.prisma và toàn bộ migrations giữ nguyên so với base; không ghi database dùng chung.

## Đã sửa

- Đổi size/topping trong một transaction trên các bảng giỏ hiện có; giữ qty hoặc gộp vào cấu hình đích với tổng<=99. Lỗi rollback, không còn thêm trước/xóa sau.
- Giỏ50 dòng vẫn sửa sang cấu hình chưa có vì không tạo dòng tạm.
- GET trả stock và tổng nhu cầu cùng sản phẩm qua các size/topping. UI cảnh báo vượt tồn, chặn checkout và cho giảm qty; không giữ chỗ tồn kho. Order Pricing vẫn kiểm tra lại.
- New-order handler/button yêu cầu báo giá thành công khớp Cart/mã/điểm hiện tại. Phục hồi Order đã gửi giữ key/payload cũ. Dùng điểm tối đa tải báo giá theo điểm đã chọn.
- AddToCart khóa ngay bằng ref trong lúc gửi để hạn chế bấm lặp. Sau lỗi tải lại giỏ và nhắc kiểm tra, không tự gửi lại POST. Không bảo đảm chống cộng trùng khi mất phản hồi hoặc thao tác ở nhiều tab; không thêm idempotency receipt hoặc sessionStorage mới.

## Áp dụng

Áp dụng patch, sau đó chạy `npm.cmd run dev` tại root với .env hiện có. Frontend/backend phải được cập nhật cùng nhau do có endpoint sửa tùy chọn mới. Không có thay đổi dependency nên không bắt buộc npm ci hoặc db:generate. Không chạy migration của gói cũ.

Nếu đã áp dụng gói cũ thì không áp chồng gói này; cần đối chiếu phần code cũ trước. Nếu migration cũ đã chạy trên database chung, gói mới không tự rollback nó: không tự xóa enum/constraint hoặc reset database.

## Kiểm chứng và giới hạn

Backend cart-service/pricing66/66 PASS; toàn bộ frontend273/273 PASS. Typecheck hai workspace, frontend lint, backend focused lint, backend build và frontend Webpack build PASS. Build mặc định Turbopack trước đó lỗi nạp CSS native trong môi trường Linux; không thay build config/dependency để xử lý. git diff --check PASS. Các PostgreSQL tests bổ sung kiểm tra chỉnh sửa tại50 dòng và rollback khi tổng tiền tràn; chưa chạy trên PostgreSQL native. Chưa kiểm thử tương tác trình duyệt hoặc ghi database Neon.

## Kiểm tra trên máy

- Đổi size/topping: qty giữ nguyên, tổng đúng; đổi sang cấu hình đã có thì gộp một dòng.
- Giỏ50 dòng vẫn sửa được; gộp vượt99 giữ nguyên dữ liệu và báo lỗi.
- Tổng cùng món vượt tồn qua nhiều size/topping: cảnh báo; giảm đủ tồn thì checkout mở.
- Mã sai, điểm sai hoặc lỗi báo giá: không đặt mới; input đúng và báo giá thành công thì mở. Order đã gửi vẫn phục hồi bằng yêu cầu cũ.
- Bấm thêm liên tiếp trong lúc chờ chỉ gửi một lần. Khi mất phản hồi, kiểm tra giỏ trước khi chủ động thêm lại.
