# Thất bại giữ giỏ — Thành công dọn trống giỏ

## Luồng giỏ đơn giản theo yêu cầu người dùng — 2026-11-02

- Tạo PENDING giữ nguyên Cart, không xóa ở create. Giỏ của owner bị khóa mọi POST/PATCH/options/DELETE khi có PENDING hoặc PAYMENT_FAILED. GET vẫn được phép. Kiểm tra dưới cùng user row lock với create/payment/cancel, không chỉ khóa giao diện. Lỗi409 INVALID_ORDER_STATE kèm existingOrderId hiện có, không endpoint/schema/enum mới.
- PAYMENT_FAILED, UNKNOWN và hủy đơn không xóa giỏ hoặc tự cộng lại món. Khách có thể thử lại thanh toán; muốn đổi món sau lỗi phải hủy đơn cũ, sau đó sửa giỏ/tạo đơn mới. Không tạo đơn thứ hai khi đơn cũ chưa được xử lý.
- Lần thanh toán thành công đầu tiên xóa TOÀN BỘ CartItem của owner, trong cùng transaction với PAID/Payment/điểm. MOCK, VNPAY verified settlement (IPN/QueryDr/receipt worker chung apply) và INTERNAL_ZERO đều dùng helper này. Lỗi cleanup rollback settlement. Replay/callback lặp không xóa giỏ của đơn mới.
- Không giữ phần số lượng thêm hoặc chia Cart A/B. Bỏ ghi metadata `_cartCleanup`, không cần provenance cho đơn mới/cũ. Giữ bộ lọc field nội bộ trên public replay để tương thích receipt đã sinh bởi bản trước. Không thay schema/migration, không backfill hoặc reset dữ liệu.
- Giao diện khóa nút thêm/sửa/xóa trong lúc kiểm tra đơn, khi lỗi kiểm tra và khi có active order; banner dẫn tới tiếp tục thanh toán/hủy. Poll/focus cập nhật trạng thái; trước khi mở khóa sau success/cancel tải lại giỏ. Backend luôn quyết định, kể cả tab khác/cache cũ.
- Các thành viên cần dùng backend mới đồng bộ; một backend phiên bản cũ vẫn có thể cho sửa Cart vì đây là rule ứng dụng, không phải constraint schema.

## Kiểm chứng

Backend regression dùng services thật với DB/loyalty mock kiểm tra create giữ giỏ, thất bại nhiều lần giữ nguyên, cả4 thao tác Cart bị chặn cho PENDING/PAYMENT_FAILED, retry thành công dọn trống, zero-total dọn trống, lỗi cleanup không trả thành công, cancelled/paid mở khóa và xác nhận lặp không dọn hai lần. Native integration assertions orders/checkout-lifecycle được cập nhật, chưa chạy vì không có PostgreSQL test native hoạt động. Chưa kiểm tra browser/provider E2E.

Không truy cập/migrate/seed database nhóm hoặc push GitHub. Không đổi schema/dependency/.env. Các full-suite operator-orders assertion cũ về deadline/serverNow đã được tái hiện trên main635c9b2 trong lần kiểm tra trước; không sửa ngoài scope. Kết quả cuối và cách chọn patch nằm ở HUONG_DAN.md.

## Kiểm tra trên máy

1. Thêm2 ly, tạo đơn: giỏ vẫn2 và mọi nút thêm/sửa/xóa bị khóa, kể cả tab khác.
2. Thanh toán thất bại: giữ nguyên2 ly; thử lại lỗi vẫn2. Muốn đổi món thì hủy đơn, giỏ được giữ và mở khóa.
3. Thành công: giỏ trống. Thêm giỏ mới sau thành công rồi nhận callback/replay lặp của đơn cũ: giỏ mới không mất.
4. Chỉ sau khi xử lý xong đơn cũ mới tạo đơn tiếp theo. MOCK/VNPAY/0 đồng dùng cùng quy tắc.

## Kết quả chạy cuối

- 150/150 focused backend tests qua6 suites PASS; frontend274/274 PASS.
- Backend/frontend TypeScript, frontend lint, focused backend lint, backend build, frontend Webpack build và git diff --check PASS.
- Full backend917/919 PASS;2 lỗi còn lại ở operator-orders về deadline/serverNow, đã tái hiện trên main635c9b2 trước đó. Chưa native PostgreSQL/browser E2E. Schema/migrations không có diff.
