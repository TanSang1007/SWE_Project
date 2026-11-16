# O01 — Hủy sau thanh toán và theo dõi đơn

Người dùng giao triển khai ngày 2026-11-15 theo [quy định hủy và theo dõi](../Quy_dinh_huy_don_va_theo_doi_don_BrewLite.txt) và [ghi chú chức năng](../thêm%20chức%20năng.txt). Đây là extension được chọn, thay phạm vi cũ Customer chỉ hủy unpaid; không sửa PDF.

## Quy tắc triển khai

- Backend dùng `paidAt` đã xác nhận, cửa sổ `[paidAt, paidAt + 120 giây)`. Đúng hạn 120 giây khóa hủy thông thường, cho phép bắt đầu pha. Kiểm tra thời gian sau khi khóa owner/Order; hủy và bắt đầu pha không thể cùng commit. Hết hạn không tự chuyển trạng thái: PAID hiển thị Chờ nhân viên bắt đầu.
- Giữ graph PAID → PREPARING → READY → COMPLETED và nhánh PAID → CANCELLED. Hủy paid trả nguyên liệu chưa dùng, đảo award/hoàn điểm đã dùng theo engine hiện có đúng một lần; Payment SUCCEEDED và số tiền lịch sử giữ nguyên. Đơn 0 VND không tạo yêu cầu hoàn tiền mặt.
- Cửa sổ áp dụng cả xác nhận VNPAY và INTERNAL_ZERO, tính từ lúc backend ghi PAID, không từ Return hoặc giờ trình duyệt. Đơn cũ dùng paidAt hiện có; không đặt lại hạn khi tải trang hoặc retry.
- Hoàn tiền được theo dõi thủ công: một yêu cầu hoàn toàn bộ cho mỗi Order/Payment thành công, PENDING/SUCCEEDED/FAILED; không có record là NOT_REQUESTED. Admin phê duyệt; chỉ xác nhận SUCCEEDED khi đã phê duyệt và cung cấp mã giao dịch cùng tham chiếu bằng chứng/đối soát. Không gọi Refund API hoặc tự chuyển tiền. Retry chỉ mở lại việc theo dõi, không tự gửi giao dịch.
- User/Staff gửi hỗ trợ cho đơn đã thanh toán bằng lý do và Idempotency-Key. Admin duyệt/từ chối từng yêu cầu; duyệt PAID hủy qua engine chung, các đơn đã pha/hoàn thành giữ tiến độ và nguyên liệu đã dùng. Hoàn tiền ngoại lệ sau pha không tự sửa điểm hay tạo nhánh Order mới ngoài graph đã chốt. Một refund mỗi đơn ngăn hoàn tiền toàn bộ lần thứ hai.
- Lưu sự kiện trạng thái bằng trigger database trong cùng transaction với Order, gồm giờ máy chủ/actor/role. Ghi thêm sự kiện hỗ trợ và hoàn tiền. Chỉ ghi lịch sử từ migration trở đi; không dựng lịch sử giả cho đơn cũ.
- Frontend đồng bộ định kỳ/focus, đồng hồ dùng serverNow và thời gian đơn điệu; backend luôn kiểm tra lại. Form không tự gửi lại mutation hoặc tự đánh dấu đã hoàn tiền khi mất kết nối.

## Contract bổ sung

- POST `/orders/:id/cancel` CUSTOMER mở thêm PAID trong cửa sổ; hết hạn 409 CANCEL_WINDOW_EXPIRED. Replay CANCELLED vẫn đọc kết quả hiện tại.
- POST `/operator/orders/:id/transitions` chặn PREPARING trước hạn bằng 409 PREPARATION_LOCKED. Admin paid-cancel là ngoại lệ có refund request, không bị giới hạn cửa sổ.
- GET `/operator/orders/:id` cho Staff đọc thêm CANCELLED có paidAt, để trang đang mở tiếp tục cập nhật sau khi Customer hủy; danh sách Staff mặc định và quyền với unpaid không đổi.
- GET `/orders/:id/tracking` CUSTOMER owner hoặc STAFF/ADMIN; trả giờ máy chủ, hạn hủy, khả năng hủy/bắt đầu, refund, support requests và events. Guest401; wrong role403; khác owner/missing404. Không trả email/secret/bằng chứng hoàn tiền nội bộ cho Customer.
- POST `/orders/:id/support-requests` CUSTOMER owner hoặc STAFF/ADMIN; `{reason}` dài 1–500, Idempotency-Key UUID. Cùng key/nội dung đọc lại, khác nội dung409 IDEMPOTENCY_KEY_REUSED.
- POST `/admin/orders/:id/support-requests/:requestId/review` ADMIN; `{expectedVersion,action:APPROVE|REJECT,note}`. Chống xử lý trùng/OCC.
- POST `/admin/orders/:id/refund` ADMIN; `{expectedVersion,action:APPROVE|SUCCEEDED|FAILED|RETRY,transactionReference?,evidenceReference?,note?}`. Thiếu bằng chứng400/422; stale409; không đủ payment thành công422 REFUND_NOT_AVAILABLE. Mã giao dịch refund unique chống sử dụng lại.

GET tracking trả200 `{orderId,status,serverNow,cancelUntil,canCancelPaid,canStartPreparing,refund,supportRequests,events}`. `cancelUntil` là ISO/null; không có refund trảnull (UI hiển thị Chưa yêu cầu), có refund trả `{id,status,amount,approved,version,createdAt,processedAt,failureReason}`; amount là chuỗi VND. Chỉ Admin nhận thêm transactionReference/evidenceReference. Support gồm `{id,reason,status,version,reviewNote,createdAt}`. Event gồm `{id,kind,fromStatus,status,actorRole,note,at}`, Staff/Admin nhận thêm actorId. Kind STATUS/SUPPORT/REFUND; role SYSTEM/CUSTOMER/STAFF/ADMIN. Không trả email hoặc credentials.

Ba POST hỗ trợ/review/refund trả200 `{id,status,version}`; DTO/query strict, expectedVersion là integer0–2147483646, reason/note sau trim1–500, transactionReference1–128, evidenceReference1–500. Tất cả response private/no-store, Vary Authorization; không có public refund endpoint. Tracking đọc UUID/ID số đã lưu theo read contract hiện hành; các mutation vẫn yêu cầu UUID. Xử lý hoàn tiền thất bại yêu cầu approval và lý do; retry FAILED→PENDING chỉ mở lại theo dõi, không tự gửi chuyển tiền. Trùng transactionReference409 CONCURRENT_UPDATE; write kỹ thuật chưa xác nhận503 SERVICE_UNAVAILABLE, phải GET trước khi xử lý tiếp.

## Database và nghiệm thu

Migration additive tạo `order_tracking_events`, `order_support_requests`, `order_refunds` với FK Order/User/Payment, ràng buộc số tiền/trạng thái/OCC/idempotency. Không sửa số dư tồn/điểm, Order hoặc Payment cũ. Runner development/test kiểm tra checksum và fingerprint mọi bảng cũ, transaction, không reset/seed.

TC01–TC12 trong nguồn: hủy 30/119 giây, từ chối 120/121; pha 60 bị chặn, từ 120 được phép; tranh chấp/lặp chỉ một lần; snapshot nguyên liệu/điểm và rollback; refund chưa xác nhận không thành công, failure hiển thị đúng; User thấy cập nhật Staff, hết hạn vẫn chờ nhân viên. Kết quả thực chạy bên dưới và [checklist](DEVELOPMENT_PLAN.md).

## Cập nhật database development

Chỉ người được giao quản lý database chạy từ thư mục gốc:

```powershell
node backend/scripts/apply-order-aftercare.cjs --check
node backend/scripts/apply-order-aftercare.cjs --apply
```

Đã áp dụng trên development trong task này: giữ fingerprint34 bảng cũ, tạo3 bảng mới không backfill; check lại xác nhận checksum đã áp dụng. Thành viên dùng chung database không chạy lại migration/reset/seed. Bản chạy localhost kiểm tra health/menu/login200,7 món và session không cookie401 UNAUTHORIZED; không tạo đơn/giao dịch thử trên database chung. Evidence `.brewlite/order-aftercare-migration.log`, `order-aftercare-runtime-result.json`.

## Kết quả kiểm chứng

- Frontend toàn bộ298/298: parser, thời gian119/120/121, quyền thao tác, kết quả thanh toán chỉ mở tracking khi backend xác nhận PAID, không tự retry write khi mất phản hồi và không nhận response của phiên khác. Evidence `.brewlite/order-aftercare-frontend-test.log`.
- Backend unit/HTTP132/132 qua cancellation-window, order-service, operator-workflow, order-history, operator-orders. Điều chỉnh6 assertion wrapper cũ thiếu actor đã có từ I07; không thay phân quyền để làm test qua. Evidence `.brewlite/order-aftercare-unit.log`.
- PostgreSQL local3 suite104/104 gồm aftercare/size-recipes/product-ingredients; sau khi hoàn tất CHECK refund và quyền Staff đọc paid CANCELLED, chạy lại aftercare32/32 trên cả UUID/TEXT. Bao phủ concurrent cancel/prepare/double cancel, refund approval/evidence/failure/retry, support replay, rollback khi insert refund lỗi, không hoàn nguyên liệu đã dùng, đơn0 VND và no-store/ownership. Evidence `.brewlite/order-aftercare-database-regression.log`, `order-aftercare-database.log`. Log lỗi HTTP do fixture cố ý gây lỗi và cảnh báo pg query đồng thời không làm suite thất bại.
- Typecheck hai workspace, Prisma validate/generate, lint các source/test thay đổi, backend TypeScript và Next production build cô lập đều đạt. Evidence `.brewlite/order-aftercare-*-typecheck.log`, `order-aftercare-*-lint.log` và `size-recipes-browser-0eac448b87ff45469b70ed4fbc2463e5/build-*.log`.
- Edge thực15 nhóm đạt: giữ10 nhóm tồn kho/công thức, thêm khách hủy ngay tại màn hình thanh toán; Admin duyệt→thất bại→mở lại→xác nhận bằng chứng; Staff chờ hạn rồi bắt đầu; khách thấy READY/COMPLETED qua polling; hỗ trợ sau hạn và Admin duyệt.0 runtime exception, ảnh390/1366px không tràn ngang, đã xem ảnh Customer mobile/Admin desktop. Evidence `.brewlite/size-recipes-browser-0eac448b87ff45469b70ed4fbc2463e5/result.json` và ảnh cùng thư mục. Database/cluster test do harness tạo đã dọn; không dùng database chung cho giao dịch thử.
- Lượt browser đầu bị409 IDEMPOTENCY_IN_PROGRESS khi transaction local lạnh vượt ngân sách400ms. Harness chỉ thử lại lỗi này bằng cùng key/body tối đa2 lần theo contract; không retry phản hồi không rõ, không tăng deadline hoặc nới guard ứng dụng. Lượt cuối đạt. Evidence `.brewlite/order-aftercare-browser-first.log`, `order-aftercare-browser.log`.
- 11 tài liệu kiểm tra liên kết không thiếu; diff check đạt (tôn trọng CRLF Windows), PDF/lockfile/private env giữ nguyên hash. Evidence `.brewlite/order-aftercare-docs-check.json`.

Giới hạn: không chạy full backend, Firefox hoặc đăng nhập bằng phiên operator thật trên database chung; chưa gọi Refund API/chuyển tiền hay xác nhận giao dịch VNPAY bên ngoài. IPN trong test là chữ ký/profile tổng hợp chỉ trên local `_test`. Admin phải thực hiện và đối soát hoàn tiền bên ngoài rồi mới ghi nhận thành công; bằng chứng test không chứng minh tiền thực đã chuyển.
