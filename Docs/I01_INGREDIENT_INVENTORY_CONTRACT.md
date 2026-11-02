# I01 — Tồn kho nguyên liệu (user extension 2026-10-29)

Amendment cùng ngày [I02](I02_INVENTORY_CATEGORIES.md) thay ngưỡng tùy chọn bằng quy tắc cố định theo đơn vị và strict `<`, phân nhóm vật dụng/nguyên liệu, đưa nhập hàng ra menu riêng. Các quy trình transaction/kiểm kê/duyệt/audit I01 giữ nguyên. Mô tả ngưỡng và đường dẫn phía dưới là baseline I01 trước amendment.

Yêu cầu người dùng mở rộng riêng nhập nguyên liệu, Staff kiểm kê, Admin phê duyệt và lịch sử. Không sửa PDF hoặc thay A06 tồn sản phẩm, checkout, payment, recipe consumption, nhà cung cấp hoặc đăng nhập. Tái sử dụng Nest/Prisma/PostgreSQL, JWT/current-role guards và shell/theme hiện tại.

## Quy tắc triển khai

- Nguyên liệu độc lập Product.stock; đơn vị KG/G/L/ML/PIECE bất biến. Decimal(12,3), số không âm tối đa999999999.999; PIECE nguyên. API nhận/trả chuỗi thập phân, không làm tròn dữ liệu nhập. Admin chọn ngưỡng sắp hết, mặc định0; hết khi quantity=0, sắp hết khi0<quantity<=threshold, còn lại còn hàng. Ban đầu tồn0; tồn đầu kỳ nhập qua phiếu hoặc kiểm kê, luôn có lịch sử.
- Admin tạo phiếu nhập DRAFT gồm1..50 dòng nguyên liệu khác nhau, lượng nhận>0, ghi chú; xác nhận CONFIRMED cộng vào số mới nhất trong một transaction. Lưu before/after/delta/actor/time từng dòng. Tạo phiếu không cộng tồn.
- STAFF gửi phiếu kiểm kê SUBMITTED gồm actual>=0, note, expectedVersion lấy từ danh sách; backend tự chụp systemQuantity/version, tự tính difference. STAFF không có API ghi tồn hoặc duyệt. Chỉ xem phiếu của mình; ADMIN xem tất cả.
- ADMIN APPROVE/REJECT/REQUEST_RECOUNT. Approve kiểm tra TẤT CẢ version nguyên liệu còn khớp lúc kiểm kê; bất kỳ thay đổi nào trả409 INVENTORY_CHANGED và không ghi gì. Không tự rebase delta hoặc overwrite tồn mới. Admin yêu cầu kiểm kê lại nếu cần. Approve cập nhật lượng thực tế, version và movement cùng transaction, kể cả dòng chênh0.
- REJECTED/RECOUNT_REQUIRED giữ bản ghi và lý do. Kiểm kê lại tạo phiếu mới với recountOfId, snapshot/version hiện tại; chỉ Staff chủ phiếu tạo, một phiếu thay thế/phiếu gốc. Không sửa kết quả kiểm kê lịch sử.
- Tạo nguyên liệu/phiếu dùng Idempotency-Key ASCII1..128, unique actor/key và hash nội dung. Confirm/approve lặp lại trạng thái đã hoàn tất cùng hành động trả resource hiện tại, không áp effect lần hai; hành động khác trên terminal state bị409. Actor lock → document lock → nguyên liệu ID tăng dần; CAS version và unique movement/source-line là lớp bảo vệ bổ sung. Lỗi bất kỳ dòng rollback toàn phiếu.
- DTO whitelist/query/body, UUID, quantity/role/ownership đều do backend kiểm tra; không nhận stock hiện tại/delta/actor/status từ client. UI giữ key/payload khi kết quả mạng chưa rõ, tránh gửi lại thành phiếu mới; tải lại sau conflict, không tự ghi đè.

## API đã triển khai và acceptance

Base `/ingredient-inventory`: GET ingredients (STAFF/ADMIN); POST ingredients (ADMIN); GET/POST receipts và POST receipts/:id/confirm (ADMIN); GET counts (STAFF own/ADMIN all), POST counts (STAFF), POST counts/:id/review (ADMIN); GET movements (ADMIN). GET receipts/counts/movements có cursor UUID,50 dòng/trang; không silently bỏ lịch sử. Strict empty GET body; route mutations strict query rỗng. Responses private/no-store/Vary Authorization; errors theo envelope hiện có.

GET summary (STAFF/ADMIN) tổng hợp totalIngredients/inStock/lowStock/outOfStock/pendingCounts từ database; pending của Staff giới hạn theo người tạo, Admin toàn bộ. Không lấy thống kê từ trang lịch sử đầu tiên. UI hiển thị tổng nguyên liệu, sắp hết, hết hàng, chờ duyệt. Các request danh sách/thống kê/phiếu/lịch sử chạy độc lập và cập nhật ngay phần thành công; lỗi một phần không che dữ liệu khác. Mỗi request có timeout12 giây, finally giải phóng loading; lỗi được thông báo và cho tải lại. Danh sách rỗng từ API vẫn mở form thêm nguyên liệu cho Admin. Không thay lỗi bằng số liệu giả.

Acceptance: Admin create→draft→confirm; Staff actual/difference→submit→Admin approve/reject/recount; fractional và PIECE bounds; quyền403/401 và ownership404; duplicate creation/hash mismatch; repeated/concurrent confirm/approve; nhập hàng trong lúc chờ duyệt không bị overwrite; rollback nhiều dòng; lịch sử before/after/actor/time; UI Staff/Admin, loading/error/empty và responsive. Kiểm thử DB trên PostgreSQL local cô lập, không synthetic writes trên Neon. Không đánh dấu hoàn tất trước khi có evidence.

[Báo cáo triển khai, sửa lỗi tải dữ liệu và kiểm thử](I01_INGREDIENT_INVENTORY_IMPLEMENTATION.md).
