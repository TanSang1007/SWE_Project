# Giỏ cập nhật tức thì và tự lưu — 2026-11-13

Bản patch cho bangchau bdf780e: giữ Docker hiện có; đã kiểm tra 58/58 tests giỏ/tự lưu/checkout/order và frontend TypeScript trên chính nhánh này. Các số liệu full-suite/build bên dưới là kết quả ở main 60bcb4d dùng để triển khai ban đầu; chưa chạy Docker/Neon thật.

Phạm vi người dùng xác nhận: FR03, FR08, UI03. Tiếp tục dùng giỏ PostgreSQL theo tài khoản; không đổi schema, migration, API, quyền hay luồng giữ giỏ khi thất bại/xóa giỏ khi thành công.

## Hành vi

- Bấm +/−: số lượng, badge, tổng số ly, thành tiền và tạm tính đổi ngay bằng BigInt từ đơn giá đã tải. Giới hạn 1–99, không hiển thị số tiền vượt 999999999999. Qty=1 bấm trừ vẫn hỏi xác nhận xóa.
- Sau 400 ms không bấm, gửi số lượng cuối cùng của từng dòng qua PATCH hiện có. Đây là gom thao tác theo dòng, không phải một batch API cho toàn giỏ. Khi mạng chậm, vẫn cho bấm số lượng; xếp yêu cầu nối tiếp và phủ bản nháp mới lên kết quả cũ, không để response cũ giật lùi số lượng đang chọn.
- Hiện “Đang lưu thay đổi”; dùng giỏ backend trả về để xác nhận giá. Giữ kiểm tra quyền, khóa đơn đang chờ, cấu hình và giá ở backend khi tự lưu; không bỏ kiểm tra an toàn để tăng tốc. Tốc độ phản hồi UI và số request cải thiện, không cam kết mỗi query database nhanh hơn.
- Chỉnh sửa size/topping: lựa chọn trong form vẫn ở client đến lúc bấm Lưu. Trước khi mở/lưu editor hoặc xóa dòng, chờ số lượng đang lưu xong để tránh mất số lượng khi gộp cấu hình. Các thao tác này tiếp tục dùng API cũ và có trạng thái chờ; không tuyên bố toàn bộ chỉnh sửa đều không chờ mạng.
- Hàng đợi ở store dùng chung nên chuyển trang nội bộ không hủy việc tự lưu. Trước khi thêm món từ trang chi tiết cũng chờ hàng đợi số lượng. Có cảnh báo trình duyệt khi đóng/tải lại trang còn đang lưu; cưỡng bức đóng vẫn có thể mất thay đổi chưa gửi. Không lưu bản nháp vào localStorage/sessionStorage, không tự retry POST thêm món.
- Nếu lưu lỗi/timeout: bỏ các thay đổi chưa xác nhận, đọc lại giỏ backend vì request có thể đã commit. Hiện lỗi và chặn sửa/checkout đến khi người dùng Tải lại giỏ thành công. Không tự gửi lại vô hạn.
- Logout/đổi tài khoản hủy hàng đợi chưa gửi và bỏ response phiên cũ. Đơn chưa hoàn tất được phát hiện thì bỏ thay đổi chưa gửi; backend vẫn là nơi chặn ghi quyết định, kể cả thao tác từ tab khác.

## Kiểm tra trước thanh toán

Nút ở giỏ thực hiện: flush tự lưu → kiểm tra đơn đang chờ → GET giỏ hiện hành → POST /orders/preview chỉ gửi productId/size/toppingIds/qty → so lại nội dung/giá → chuyển /checkout. Có lỗi thì giữ trang giỏ, thông báo lỗi. Có thay đổi giá/nội dung thì yêu cầu xem lại và bấm tiếp, không tự tạo Order. Preview hiện có kiểm tra lại giỏ và tồn kho, không giữ hàng; lúc POST /orders vẫn phải xác thực, tính giá và giữ tồn trong transaction như trước. Checkout trực tiếp vẫn chờ tự lưu qua store.load và kiểm tra lại bằng luồng preview/create hiện hữu.

## Kiểm chứng

- Unit tests giỏ/tự lưu/checkout/order (58/58 ở lần kiểm tra cuối): xem frontend/test/cart-autosave.test.mjs và các suite hiện có. Kiểm tra gom click, giữ bản nháp khi response chậm, nhiều dòng, lỗi/timeout, phiên cũ, GET cũ, active Order, flush đồng thời, overflow và thứ tự preflight. Hai assertion xác nhận xóa trong cart.test.mjs được cập nhật cho UI một câu đã có trên main.
- TypeScript và production Webpack build được kiểm tra; lint phần sửa không có lỗi. Full lint có hai cảnh báo ảnh img đã có trên main.
- Full frontend suite: baseline 262 tests, 246 pass/16 fail; đợt chạy sau thay đổi 276 tests, 262 pass/14 fail. Không phát sinh tên lỗi mới; 2 lỗi cũ ở cart.test.mjs được cập nhật đúng UI. Các lỗi catalog/Admin/order-history còn lại nằm ngoài task. Không tuyên bố full suite xanh.
- Chưa kiểm tra với database Neon thật hoặc VNPAY. Chromium headless tại môi trường kiểm tra bị chặn tạo socket, chưa có browser E2E cho thay đổi này.

## Tự kiểm tra trên máy chạy thật

1. Chọn giỏ có món còn bán, không có Order chưa hoàn tất. Bấm + liên tục 5 lần: số lượng và tạm tính đổi ngay, không khóa cả giỏ vì tự lưu.
2. F12 Network: một lượt PATCH cho chuỗi bấm trong 400 ms của cùng dòng. Nếu bấm khi PATCH trước đang chạy, có lượt tiếp theo cho số lượng mới nhất, không chạy song song.
3. Chờ hết “Đang lưu”, F5: số lượng đã lưu còn nguyên. Đổi size/topping rồi lưu; kiểm tra số lượng không mất khi gộp dòng. Trừ qty1 vẫn hỏi xóa.
4. Bấm thanh toán ngay sau bấm +: chờ PATCH xong, kiểm tra giỏ/preview rồi mới chuyển trang. Giá/tồn thay đổi: báo xem lại hoặc lỗi thay vì tạo đơn sai.
5. Ngắt mạng trong khi tự lưu: hiện lỗi, không cho thanh toán. Kết nối lại và Tải lại giỏ; kiểm tra số lượng thực tế trước khi thao tác tiếp.
6. Kiểm tra Order PENDING/PAYMENT_FAILED vẫn khóa chỉnh sửa; thành công dọn giỏ, thất bại giữ giỏ như trước.
