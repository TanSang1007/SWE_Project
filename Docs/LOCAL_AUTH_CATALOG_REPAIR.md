# Khôi phục auth và catalog — 2026-11-12

Người dùng giao sửa lỗi kiểm tra phiên, cấu hình hai tài khoản Admin/Staff và hiển thị đủ7 món. Mapping: FR01/FR04/FR05/NFR05, B03/B06/B07/A01/UI01. Không đổi PDF.

## Nguyên nhân và thay đổi

- Shared development có ID TEXT/số khác schema UUID repository. Khóa phiên `id=$1::uuid` gây500; nay dùng `id::text=$1`, giữ row lock và parameter binding. Cookie UUID không tồn tại trước sửa trả500, sau sửa trả401.
- AuthSession trước đây chặn cả menu/login khi restore lỗi. Nay public pages vẫn render; private pages giữ loading/error/Retry cho tới khi kiểm tra xong. Không coi lỗi mạng là logout.
- Database còn9 tài khoản; hai email được người dùng chỉ định chưa tồn tại. Đã thêm đúng hai operator với bcrypt cost10, giữ9 tài khoản cũ; không có bằng chứng ứng dụng đã xóa toàn bộ User. Không lưu mật khẩu thật vào source/tài liệu.
- Catalog chỉ có Cappuccino/Latte với ID BR001/BR002 và topping ID số, không hợp lệ với catalog UUID contract. Chuẩn hóa hai Product/hai Topping về UUID ổn định bằng ON UPDATE CASCADE sau khi kiểm tra tất cả FK; thêm5 món. Không đổi kiểu cột/schema hoặc chạy seed/reset trên Neon.
- Order cũ có ID số khiến frontend từ chối cả danh sách tổng quan Admin. Cho phép đọc ID cũ thay vì đổi Order hoặc lịch sử.

`common/record-id.ts` nhận UUID hoặc số nguyên dương dạng chuỗi tối đa20 chữ số cho User/Session và GET Order. Cookie token vẫn43 ký tự base64url; malformed ID bị chặn trước SQL. Giữ rotation/reuse detection, absolute expiry, HttpOnly/SameSite/CSRF và role đọc DB. Các bản ghi application mới tiếp tục UUID.

GET `/orders/:id` và GET `/operator/orders/:id` nhận thêm ID số cũ; permission/ownership/error/no-store giữ nguyên. Order mutations vẫn yêu cầu UUID. Frontend history/overview/detail đọc được ID số. Prisma schema vẫn UUID; đợt này không đồng bộ mọi kiểu ID/SQL mutation trên database dùng chung.

## Danh mục và bảo toàn dữ liệu

| Món | Giá gốc VND | Ảnh |
| --- | ---: | --- |
| Cappuccino | 45000 | cappuccino.jpg |
| Latte | 40000 | latte.jpg |
| Cold brew | 50000 | cold-brew.jpg |
| Đen đá | 100 | den-da.jpg |
| Asian Dolce Latte | 75000 | asian-dolce-latte.jpg |
| Matcha Coldwisk | 70000 | coldwisk.jpg |
| Cacao đá | 65000 | cacao-da.jpg |

Giữ hai giá đang có; Cold brew/Đen đá theo quyết định cũ. Người dùng cho phép chọn ba giá thiếu trong60000–80000 VND. Size/topping dùng cấu hình development hiện có. Còn/hết theo nguyên liệu I05; không tự cộng kho để làm món có thể đặt.

Transaction đối chiếu snapshot: giữ9 User cũ, tổng11 sau khi thêm hai operator; giữ giá/tồn/version/timestamps của hai Product cũ. Các bảng còn lại giữ nội dung sau chuẩn hóa FK catalog. Không đổi Order status/tiền, Payment/Loyalty hoặc lượng nguyên liệu. Phiên kiểm tra được logout sau sử dụng.

Seed bổ sung7 món; CLI chỉ chấp nhận local `_dev`/`_test` trong development, từ chối remote trước khi kết nối. Không seed tài khoản/startup. Cập nhật Neon là thao tác theo phạm vi người dùng giao, không nới guard CLI provision create-only.

## Kiểm chứng và giới hạn

Acceptance: Admin/Staff vào đúng trang và giữ phiên qua hai F5; logout; menu khách7 món/đủ chi tiết; public menu không bị session outage chặn nhưng private content bị chặn; tổng quan/chi tiết Order số cũ đọc được. [Kết quả cuối và checklist](DEVELOPMENT_PLAN.md).

Evidence ignored: `.brewlite/auth-menu-browser-result.json`, ảnh `auth-menu-desktop-20261112.png`/`auth-menu-mobile-20261112.png`, `auth-final-*.log`, `auth-catalog-integration.log`. PostgreSQL tests dùng cluster local riêng, không dùng Neon làm fixture. Chưa nghiệm thu checkout, mutation Order ID số cũ, VNPAY hoặc toàn bộ schema dùng chung.
