# I04 — Thay danh mục tồn kho theo yêu cầu 2026-11-07

**Ngưỡng hiện hành:** [I06](I06_INGREDIENT_WARNING_THRESHOLDS.md) thay các ngưỡng và so sánh strict của9 nguyên liệu bên dưới theo file người dùng; tên/đơn vị/danh mục giữ nguyên. Các kết quả/ngưỡng của I04 dưới đây là lịch sử.

Extension người dùng của I03, không thay yêu cầu PDF. Danh mục hiện hành gồm đúng 5 vật dụng và 9 nguyên liệu dưới đây, thay danh sách cũ trong [ingredient-catalog.ts](../backend/src/ingredients/ingredient-catalog.ts). Người dùng bổ sung Đường (kg) sau danh sách11 mục ban đầu trong cùng ngày2026-11-07. Đường dùng lại bản ghi/tồn cũ cùng tên chuẩn hóa và đơn vị nếu có; nếu chưa có, Admin initializer tạo tồn0 như các mục khác. Không cần migration mới.

| Nhóm | Mặt hàng | Đơn vị |
| --- | --- | --- |
| Nguyên liệu | Bột matcha | kg (KG) |
| Nguyên liệu | Sữa tươi | lít (L) |
| Nguyên liệu | Sữa đặc | lít (L) |
| Nguyên liệu | Cà phê | kg (KG) |
| Nguyên liệu | Bột ca cao | kg (KG) |
| Nguyên liệu | Sốt caramel | chai (BOTTLE) |
| Nguyên liệu | Đường | kg (KG) |
| Nguyên liệu | Bột quế | kg (KG) |
| Nguyên liệu | Đá | bao (BAG) |
| Vật dụng | Ly thủy tinh cao | cái (PIECE) |
| Vật dụng | Ly đá lùn | cái (PIECE) |
| Vật dụng | Cốc sứ | cái (PIECE) |
| Vật dụng | Thìa nhỏ | cái (PIECE) |
| Vật dụng | Ống hút | cái (PIECE) |

Người dùng xác nhận cảnh báo khi còn dưới 10 chai; 10 chai là còn hàng, 0 là hết hàng. Chai là đơn vị đếm nguyên và thuộc nguyên liệu. Các ngưỡng cái10/lít5/kg10 giữ nguyên. EGG/G/ML vẫn được hỗ trợ cho chứng từ và hàng cũ.

## Bổ sung Bột quế và Đá (2026-11-07)

Người dùng yêu cầu thêm Bột quế (KG), Đá (BAG) và xác nhận cảnh báo khi tồn dưới5 bao. BAG thuộc nguyên liệu, nhãn bao và lượng nguyên;0 hết hàng,1–4 sắp hết,5 trở lên còn hàng. KG vẫn hỗ trợ số thập phân và cảnh báo dưới10kg. Tổng danh mục hiện hành14 mục:5 vật dụng/9 nguyên liệu.

[Migration BAG](../backend/prisma/migrations/20261107100000_inventory_bag_unit/migration.sql) thêm enum và cập nhật hai CHECK đếm/ngưỡng; không đổi bảng, FK/quan hệ hoặc dữ liệu cũ. DTO tạo/đọc thêm BAG; receipt/count từ chối bao lẻ bằng422 INVALID_QUANTITY. Không đổi path/quyền/trạng thái/error envelope hoặc idempotency. Admin initializer tạo thiếu tồn0, dùng lại tên/đơn vị đúng và giữ mismatch409 rollback.

Fallback hiện có bổ sung tùy chọn riêng: `node backend/scripts/apply-ingredient-inventory.cjs --bag-unit --check`, sau kiểm tra dùng `--bag-unit --apply`, rồi Prisma generate theo quy trình bên dưới. Không sửa lại migration BOTTLE đã áp dụng.

Acceptance bổ sung: đủ Bột quế KG/Đá BAG ở kho và phiếu mới; nhập5 bao→Staff đếm4→Admin duyệt→tồn4 cảnh báo; nhập/đếm bao lẻ bị chặn; bằng5 còn hàng,0 hết hàng; giữ tồn/lịch sử và initializer lặp không nhân đôi.

Kiểm chứng bổ sung BAG: frontend ingredients24/24, backend catalog/policy18/18, PostgreSQL local cô lập38/38 PASS; gồm14 tên/đơn vị, quyền, replay, mismatch, rollback/audit, ranh giới0/4/5/6 và nhập5→kiểm kê4, bao lẻ bị chặn ở frontend/API/DB. Frontend TypeScript, backend TypeScript build cô lập `.brewlite/bag-backend-20261107/`, Prisma generate, lint source/test/script thay đổi, cú pháp script, liên kết tài liệu và diff check PASS. PostgreSQL vẫn có cảnh báo `pg` query concurrency và log lỗi dự kiến của fault tests như baseline. Migration BAG đã áp dụng trên Neon development, fingerprint31 bảng giữ nguyên; không seed hoặc nhập tồn thử lên Neon. Read-only xác nhận trước khi triển khai chưa có Bột quế/Đá; Admin tải lại kho để initializer tạo thiếu tồn0 đúng actor. Backend watch đã biên dịch catalog/policy BAG mới. Chưa chạy lại browser E2E/Next production build cho bổ sung này; bằng chứng17 luồng phía dưới thuộc bản11 mục trước đó.

## Dữ liệu và API

- Bỏ mục khỏi danh mục chỉ ngừng liệt kê trong kho/phiếu mới, giữ bản ghi, số lượng, ID, phiên bản và lịch sử. Các mục cùng tên chuẩn hóa và đơn vị được dùng lại. Không chuyển tồn ly nhựa/thìa nhựa sang ly thủy tinh/thìa nhỏ.
- Admin tải kho/nhập hàng gọi initializer hiện có, tạo phần thiếu với tồn0 và đúng actor đăng nhập. Không seed số lượng hay giả danh Admin bằng script triển khai. Staff chỉ đọc/gửi kiểm kê.
- Bổ sung enum BOTTLE trong Prisma và [migration](../backend/prisma/migrations/20261107090000_inventory_bottle_unit/migration.sql). CHECK bảo vệ ngưỡng10 và lượng chai nguyên; giữ toàn bộ FK/quan hệ và bảng I01, không đổi dòng nghiệp vụ.
- DTO tạo/đọc mặt hàng nhận thêm BOTTLE; nhập hàng và kiểm kê từ chối số lẻ chai bằng422 INVALID_QUANTITY như các đơn vị đếm cũ. Không đổi path, quyền, trạng thái, idempotency hoặc error envelope.

## Triển khai

Áp dụng migration đã review trước khi chạy backend mới. Quy trình thông thường dùng Prisma migrate deploy theo phân công quản lý DB. Fallback hẹp hiện có bổ sung tùy chọn riêng cho migration này:

```powershell
node backend/scripts/apply-ingredient-inventory.cjs --bottle-unit --check
node backend/scripts/apply-ingredient-inventory.cjs --bottle-unit --apply
npm.cmd run db:generate --workspace backend
```

Fallback kiểm tra chain/checksum/schema, transaction và fingerprint mọi bảng nghiệp vụ; không reset/seed. Build/restart theo launcher hiện có, giữ quy tắc callback/payment continuity. Admin tải lại kho để khởi tạo phần thiếu. Các bảng và acceptance I03 cũ là lịch sử; danh mục ở tài liệu này thay thế danh sách trước đó.

## Acceptance và kiểm chứng

Acceptance: kho/phiếu mới đúng14 tên và đơn vị,5 vật dụng/9 nguyên liệu; dùng lại tồn cũ cùng tên/đơn vị; mục bị bỏ không xuất hiện trong danh sách mới nhưng chứng từ vẫn đọc được; initializer lặp không nhân đôi; sốt caramel nhập12→Staff đếm9→Admin duyệt→tồn9 cảnh báo, reload giữ nguyên; chai lẻ bị chặn ở frontend/API/DB.

Bổ sung Đường (kg): backend catalog7/7 và lint catalog/test liên quan PASS; cú pháp browser harness, liên kết tài liệu hiện tại và diff check PASS. Fixture database/browser đã cập nhật12 mục; `backend/dist/ingredients/ingredient-catalog.js` đã có Đường KG do watch biên dịch. Không chạy lại PostgreSQL/browser/production build hoặc ghi dữ liệu kho trực tiếp cho bổ sung một mục này; Admin tải lại kho/nhập hàng để áp dụng danh mục bằng initializer hiện có.

Đã kiểm chứng trước khi bổ sung Đường (danh sách11 mục):

- Frontend ingredients23/23, backend catalog/policy16/16 và PostgreSQL local cô lập36/36 PASS. Bao gồm đúng11 tên/đơn vị, dùng lại tồn, initializer lặp, mismatch rollback, quyền, stale, audit, chai nguyên và các ranh giới0/9/10/11. PostgreSQL suite có cảnh báo `pg` query concurrency và log lỗi dự kiến từ fault/constraint tests như baseline.
- Frontend/backend TypeScript noEmit và lint các source/test/script thay đổi PASS. Prisma generate PASS. Kiểm tra cú pháp script và `git diff --check` PASS.
- Migration BOTTLE đã áp dụng trên Neon development; fingerprint dữ liệu của31 bảng giữ nguyên. Chạy lại `--bottle-unit --check` xác nhận đã áp dụng, không thay dữ liệu. Không seed hoặc nhập tồn thử lên Neon; các mặt hàng thiếu vẫn do Admin initializer tạo khi tải lại trang.
- Backend TypeScript build cô lập và Next production build PASS. Edge headless17/17 luồng PASS trên database local riêng: đúng11 mục, nhập/kiểm kê chai12→9, cảnh báo và reload, vật dụng9/10, số lẻ bị chặn, history/quyền/stale/recount và giữ tồn sản phẩm. Không runtime exception hoặc tràn ngang toàn trang ở1366/390px. Đã xem ảnh kho nguyên liệu390px.
- Evidence ignored: `.brewlite/ingredients-browser-104c535e91e9497eb73272599295356c/` chứa result.json, ảnh và build/server logs. Harness dọn database/browser profile test; không dùng tài khoản hoặc dữ liệu test trên Neon. Sandbox ban đầu chặn spawn EPERM; browser/build chạy lại với quyền spawn được duyệt.
- Runtime hiện có: frontend `/admin/inventory` và backend `/health` HTTP200; `backend/dist/ingredients/ingredient-catalog.js` đã có danh mục mới. Không restart/kill runtime hoặc callback của người dùng. Chưa đăng nhập Admin trên runtime chung; Admin tải lại kho để initializer ghi các mục còn thiếu đúng actor. Không chạy toàn bộ test suite ngoài phạm vi nguyên liệu/danh mục.
