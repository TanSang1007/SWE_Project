# I08 — Đối chiếu quy định tồn kho và trạng thái món

Nguồn người dùng giao ngày 2026-11-13: [quản lý tồn kho](../%23%20QUY%20ĐỊNH%20HỆ%20THỐNG%20QUẢN%20LÝ%20TỒN%20KHO%20–%20BR.md), [trạng thái món](../%23%20QUY%20ĐỊNH%20TRẠNG%20THÁI%20CÒN%20MÓN%20VÀ%20HẾT%20MÓN.md). Đây là amendment của I01/I07, giữ PDF và các quyền Staff kiểm kê/Admin duyệt.

## Phạm vi và nghiệm thu

- Giữ công thức S/M/L hiện có, khả dụng = vật lý − đã giữ; số ly lấy min(floor(khả dụng/định lượng)). Trên 10 còn món, 1–10 sắp hết, 0 hết món; topping và trạng thái kinh doanh độc lập. Không dùng ví dụ Matcha trong tài liệu để thay toàn bộ công thức đã chốt.
- Chốt bổ sung của người dùng: **chỉ bán tại chỗ**, không mang đi/bao bì/cấu hình mang đi. **Không tính chênh lệch đá viên hoặc vật dụng**; phiếu mới và cấu hình ngưỡng chỉ cho nguyên liệu được kiểm kê. Đá vẫn tham gia công thức/giữ/tiêu hao và trạng thái hết món.
- **Nước lọc giữ trong công thức tham khảo, không quản lý tồn.** Bỏ khỏi danh mục đang nhập (còn 12 nguyên liệu/6 vật dụng), snapshot mới/Cart/pricing/availability không cần nước. Hàm inventoryRecipeForDrink lọc nước khỏi định lượng quản lý, không sửa ba file công thức hoặc recipeForDrink tham khảo. Giữ nguyên identity/tồn/lịch sử nước cũ và snapshot Order đã tạo; không tự xóa hoặc thay định lượng đơn cũ.
- Giữ reserve tại PENDING, consume tại PREPARING đúng một lần, release phần chưa dùng khi được phép; không hoàn phần đã tiêu hao. Không thay financial guards hoặc thời hạn thanh toán.
- Staff lưu nháp và gửi phiếu; Admin chỉ duyệt phiếu đã gửi. Phiếu mới dùng bốn trạng thái DRAFT/SUBMITTED/APPROVED/REJECTED. REQUEST_RECOUNT ghi REJECTED cùng cờ yêu cầu kiểm kê lại; dữ liệu RECOUNT_REQUIRED cũ vẫn đọc được. Không có API xóa phiếu đã duyệt.
- Snapshot tại lúc ghi nhận: tồn vật lý, phiên bản, mốc nhật ký, tiêu hao từ đầu ngày Việt Nam tới lúc kiểm kê và ngưỡng sai lệch đang cấu hình. Tỷ lệ = abs(thực tế − lý thuyết) / tiêu hao × 100; tiêu hao 0 trả tỷ lệ null và đánh giá theo ngưỡng tuyệt đối. Mọi chênh lệch được lưu, ngưỡng không tự phê duyệt.
- Khi duyệt, khóa nguyên liệu và đối chiếu chuỗi giao dịch sau mốc snapshot. Tồn mới = tồn hiện tại + chênh lệch đã kiểm kê. Nhập/tiêu hao/giữ/giải phóng phát sinh không bị ghi đè. Chặn nếu nhật ký không khớp, có phiếu kiểm kê khác đã điều chỉnh cùng mặt hàng sau snapshot hoặc tồn mới nhỏ hơn phần đã giữ. Phiếu cũ chưa có snapshot nhật ký vẫn dùng guard phiên bản cũ.
- Người dùng chọn **bỏ qua cảnh báo theo tiêu thụ trung bình/ngày dự phòng**. Không thêm trường/cấu hình/công thức này; giữ cảnh báo tồn theo ngưỡng hiện hành của I06/I07 và không tự nhập hàng.

## Ngưỡng kiểm kê

Khô 3%/lỏng 5% trong nguồn là đề xuất, không tự gán mặc định. Admin cấu hình tỷ lệ/ngưỡng tuyệt đối riêng cho nguyên liệu; chưa cấu hình vẫn lưu chênh lệch và hiển thị UNCONFIGURED. Đá/vật dụng/nước không nằm trong lựa chọn. Không còn câu hỏi mang đi hoặc kỳ dự phòng cần giải quyết cho phạm vi đã chốt.

**Làm rõ đã được người dùng xác nhận ngày 2026-11-15:** x% là ngưỡng sai lệch/hao hụt riêng từng nguyên liệu khi pha chế thực tế. Cacao chuẩn 20 g/ly có thể dùng 22–23 g, tương ứng sai lệch 10–15%; giữ công thức và lượng giữ/trừ chuẩn, đối chiếu lượng thực tế qua kiểm kê cuối kỳ. Không tự cộng x% vào định lượng hoặc suy rằng từng ly đều dùng một lượng thực tế cố định.

Ví dụ 100 ly tiêu hao lý thuyết 2 kg cacao; từ tồn đầu 5 kg còn lý thuyết 3 kg, không có giao dịch khác. Kiểm kê còn 2.8/2.7/2.6 kg cho chênh lệch -0.2/-0.3/-0.4 kg và tỷ lệ 10/15/20%. Nếu Admin chọn ngưỡng 15% thì hai mức đầu trong ngưỡng, mức cuối cảnh báo. 15% chỉ là dữ liệu minh họa; mọi chênh lệch vẫn lưu và cần Admin duyệt để điều chỉnh tồn. Cơ chế `countVariance` hiện có đáp ứng quy tắc này; không sửa schema/API hoặc công thức.

Kiểm chứng bổ sung ngày 2026-11-15: thêm ba trường hợp cacao 22/23/24 g bình quân vào `inventory-control.spec.ts` để kiểm tra tỷ lệ trên tiêu hao trong kỳ và ngưỡng có tính dấu bằng. Hai suite kiểm kê/công thức đạt 51/51, lint file test đạt; evidence `.brewlite/cacao-variance-regression.log`. Lượt làm rõ này chỉ sửa tài liệu và bổ sung regression, không thay lượng tồn hoặc cấu hình ngưỡng trên database; không chạy lại toàn bộ build/database/browser.

## Bảo toàn và kiểm chứng

Migration chỉ bổ sung snapshot/cấu hình/mốc nhật ký; không đổi ID, tên/đơn vị/lượng tồn, đơn/thanh toán hoặc công thức hiện hành. Đã áp dụng lên development ngày 2026-11-13, đối chiếu fingerprint giữ nguyên 34 bảng lịch sử; ngưỡng để chưa cấu hình. Kiểm tra lại ngày 2026-11-15 xác nhận migration đã áp dụng, không thay đổi thêm dữ liệu. Giữ checksum migration; Prisma map đúng tên index `ingredient_movements_ingredient_sequence_idx` đã tạo.

Nghiệm thu thực chạy ngày 2026-11-13–15:

| Kiểm tra | Kết quả và evidence trong `.brewlite/` |
| --- | --- |
| Backend unit/HTTP | 105/105 qua 7 suite: policy/DTO/quyền, nháp/gửi/duyệt, công thức/nước/danh mục. `inventory-control-unit-final.log` |
| PostgreSQL local | 165/165 qua 5 suite, gồm schema UUID và TEXT cũ: snapshot tiêu hao/ngưỡng, duyệt sau nhập/tiêu hao/giữ/giải phóng, replay, hai phiếu chồng nhau, journal thiếu/rollback, công thức và catalog. `inventory-control-catalog-regression.log` |
| Frontend | 290/290. `inventory-control-frontend-final.log` |
| Static và build | Typecheck hai workspace, Prisma validate/generate, backend lint, backend build và Next production build cô lập đạt. Frontend lint 0 lỗi, còn 1 cảnh báo logo `<img>` đã có trước tại `menu.tsx:22`; lệnh có `--max-warnings=0` chưa đạt. Hai log `inventory-control-backend-lint.log`, `inventory-control-frontend-lint.log`; build trong `inventory-control-browser.log` |
| Edge với Nest/PostgreSQL thật | 10 nhóm đạt, 0 runtime exception. Admin cấu hình ngưỡng, Staff lưu nháp/gửi phiếu, kiểm tra quyền, không thay tồn trước duyệt. Nhập thêm 200 ml sau snapshot rồi duyệt thiếu 10 ml vẫn giữ giao dịch nhập, tồn cuối 600 ml; duyệt lại không tạo movement thứ hai. Kiểm tra size/topping, giữ/giải phóng/tiêu hao và giao diện 390/1366 px đạt. `size-recipes-browser-cf75453bf999477c905fa21bad5529a3/result.json` và ảnh cùng thư mục |
| Runtime development sau khi tiếp tục | Backend `/health` và `/products` 200, đủ 7 món có `sizeAvailability`; frontend `/login` 200; session không cookie 401 `UNAUTHORIZED`. `inventory-control-live-result.json` |
| Tài liệu | Kiểm tra liên kết local, `git diff --check` và hash PDF baseline không đổi |

Database integration và browser chỉ ghi vào PostgreSQL local riêng với tài khoản/khóa synthetic; không nhập tồn giả, seed/reset hoặc tạo giao dịch tài chính thử trên development. Harness tự dọn database/profile và dừng cluster thử nghiệm. Evidence local được gitignore; report không chứa credential thật.

Chưa chạy full backend suite, Firefox, VNPAY thật hoặc đăng nhập development bằng mật khẩu thật. Browser dùng xác nhận đơn tổng tiền 0 nội bộ, không gọi gateway. Có thể chạy lại bằng `npm.cmd run test:recipes:browser --workspace frontend` với `TEST_DATABASE_URL` trỏ PostgreSQL local có tên database kết thúc `_test` và Edge đã cài; harness dùng 3100/3101, tự tạo/xóa database riêng. Checklist hoàn thành và mapping nằm tại [DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md) và [TRACEABILITY_MATRIX](TRACEABILITY_MATRIX.md).
