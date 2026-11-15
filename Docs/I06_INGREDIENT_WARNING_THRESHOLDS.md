# I06 — Ngưỡng cảnh báo nguyên liệu theo file người dùng (2026-11-07)

Nguồn: `nguong_canh_bao_ton_kho_brewlite.txt` người dùng cung cấp từ Downloads. Người dùng yêu cầu chỉ chỉnh ngưỡng, giữ nguyên tên; không lấy các lưu ý trong file về hạn sử dụng hoặc quản lý tiêu thụ làm task mới. PDF yêu cầu không thay đổi.

| Tên hiện có (giữ nguyên) | Đơn vị hiện có | Sắp hết khi 0 < tồn ≤ |
| --- | --- | --- |
| Bột ca cao | kg | 1 |
| Bột matcha | kg | 0,5 |
| Bột quế | kg | 0,1 |
| Cà phê | kg | 3 |
| Sốt caramel | chai | 1 |
| Sữa tươi | lít | 10 |
| Sữa đặc | lít | 3 |
| Đá | bao | 1 |
| Đường | kg | 5 |

File ghi caramel1 lít và đá10kg. Người dùng chọn quy đổi và cung cấp mỗi chai caramel khoảng1 lít, mỗi bao đá khoảng10kg, nên ngưỡng tương ứng1 chai và1 bao. Không đổi đơn vị hoặc quy đổi lượng tồn đã lưu; không coi việc áp dụng số1/10 trực tiếp vào chai/bao là quyết định của người dùng.

Hết hàng khi tồn0; nguyên liệu trong bảng sắp hết khi0<tồn≤ngưỡng, còn hàng khi lớn hơn ngưỡng. Vật dụng giữ ngưỡng10 cái và so sánh strict `<` như cũ; bản ghi ngoài danh mục giữ quy tắc trước đó. Còn/hết món I05 vẫn chỉ xét nguyên liệu>0, không lấy cảnh báo sắp hết làm hết món.

## Thay đổi và bảo toàn dữ liệu

- [ingredient-catalog.ts](../backend/src/ingredients/ingredient-catalog.ts) giữ nguyên14 tên/đơn vị; chỉ thêm lowStockThreshold cho9 nguyên liệu. Validate tối đa3 chữ số thập phân, không âm, threshold đơn vị đếm phải nguyên. unitThreshold cũ là fallback cho hàng không thuộc bảng.
- Create/initializer lấy threshold theo tên chuẩn hóa và đơn vị, không áp một ngưỡng chung cho mọi KG/L. Không sửa requestHash lịch sử; create replay có threshold tường minh giữ hash cũ, request cũ bỏ threshold được đối chiếu cả default theo đơn vị trước I06 để vẫn replay đúng key/name/unit. Payload khác vẫn409 IDEMPOTENCY_KEY_REUSED.
- [Migration](../backend/prisma/migrations/20261107120000_ingredient_warning_thresholds/migration.sql) chỉ sửa low_stock_threshold của9 tên/đơn vị khớp và thay CHECK ingredients_unit_threshold_check bằng chính sách theo mặt hàng, fallback chính sách cũ. Giữ các CHECK quantity/countable khác, bảng/cột/FK/quan hệ. Không sửa name, normalized_name, unit, quantity, version, timestamps, actors, phiếu, journal hoặc request hashes.
- GET ingredients bổ sung lowStockInclusive:boolean để UI hiển thị đúng `≤` hoặc `Dưới`. List/summary dùng cùng danh mục/predicate, không làm lệch thống kê ở đúng ngưỡng. Không đổi path, input DTO, quyền, pagination hoặc error envelope; không thêm màn hình chỉnh tên/đơn vị.
- UI đọc lowStockThreshold/lowStockInclusive từ server; form tạo cũ giải thích ngưỡng theo mặt hàng thay vì hứa ngưỡng KG/L chung. Không nhân bản9 ngưỡng vào frontend. Không thay công thức, menu, đặt hàng hoặc số lượng tồn.

## Triển khai

Fallback hẹp hiện có kiểm tra migration chain/checksum/schema và fingerprint toàn bộ bảng, chỉ loại low_stock_threshold khỏi fingerprint ingredients:

```powershell
node backend/scripts/apply-ingredient-inventory.cjs --warning-thresholds --check
node backend/scripts/apply-ingredient-inventory.cjs --warning-thresholds --apply
```

Migration không cần seed, khởi tạo lại kho hoặc Prisma generate vì không thêm field Prisma. Backend/frontend cần nhận source mới theo quy trình chạy hiện có. Tải lại trang kho để đọc ngưỡng mới.

Acceptance: đúng9 ngưỡng/boundary theo bảng; zero hết, bằng ngưỡng sắp hết, lớn hơn còn; supplies không đổi; list/summary đồng nhất; mọi tên/đơn vị/lượng tồn/version/audit giữ nguyên; initializer/replay không tạo trùng hoặc làm mất recovery; I05 còn món khi nguyên liệu dương dù sắp hết.

Đã kiểm chứng:

- Backend policy/catalog27/27 và frontend ingredients25/25 PASS; giữ nguyên danh sách14 tên/đơn vị và kiểm tra9 ngưỡng thập phân/chai/bao, zero/bằng ngưỡng/lớn hơn, metadata/table và supplies strict `<`. Validate cấu hình sai, replay cũ bỏ/tường minh threshold và payload khác vẫn hoạt động.
- PostgreSQL ingredients48/48 và migration-preservation1/1 PASS. Migration test khởi tạo14 mặt hàng theo baseline trước I06 rồi áp dụng migration; mọi field ngoài low_stock_threshold giống hệt trước đó. List/summary khớp tại9 ranh giới; DB CHECK không nhận threshold ngoài chính sách. Suite có cảnh báo `pg` query concurrency và log lỗi dự kiến của fault/constraint cases như trước.
- Hồi quy PostgreSQL I05 cuối14/14 PASS: sắp hết vẫn còn món nếu nguyên liệu dương, cùng create/cancel/replay/zero/failure/retry và snapshot cũ. Một lượt trước đạt13/14 do create sau nhập lại trả409; bổ sung assertion in rõ body lỗi và chạy lại độc lập14/14 PASS, không sửa production để bỏ qua409. Chưa xác định nguyên nhân409 của lượt trước; giữ ghi nhận thay vì tuyên bố lỗi đó đã được sửa.
- Edge headless22/22 luồng PASS:9 dòng đúng tên/đơn vị/ngưỡng, bằng ngưỡng đều Sắp hết, vượt ngưỡng Còn hàng; vật dụng9/10 và workflow nhập/kiểm kê giữ nguyên; hồi quy7 công thức I05 không coi nguyên liệu sắp hết là hết món. Không runtime exception hoặc tràn ngang toàn trang1366/390px. Đã xem ảnh9 ngưỡng1366px.
- Evidence ignored: `.brewlite/ingredients-browser-8f0024c798ae4febb6bce6783d6c20f6/` có result.json, ảnh `admin-warning-limits-*` và build/server logs. Backend build và Next production build PASS; frontend/backend TypeScript và lint source/test/script liên quan PASS. Kiểm tra cú pháp script và diff check PASS. Browser/build cần quyền spawn ngoài sandbox đã được duyệt.
- Migration I06 đã áp dụng trên Neon development; fingerprint31 bảng giữ nguyên, chỉ loại cột low_stock_threshold của ingredients khi đối chiếu. Chạy lại `--check` xác nhận đã áp dụng; read-only đối chiếu9 ngưỡng thực tế khớp cấu hình. Không đổi số lượng, seed, rename hoặc thay đơn vị.
- Backend build chính đã nhận đủ9 ngưỡng mới. Tại kiểm tra cuối, cổng3000/3001 không có ứng dụng chính và `dev:status` trả NO_MANAGED_RUNTIME; không tự khởi động/restart callback/payment runtime. Người dùng chạy lại ứng dụng theo quy trình hiện có rồi tải lại kho. Browser dùng database/ports riêng và tự dọn database/profile test.

Không chạy toàn bộ test suite hoặc giao dịch VNPAY thật; không thay các fixture hồi quy Cart/A06 cũ được nêu trong I05. Các phần chỉnh trước của workspace được giữ nguyên, không sửa PDF, `.env` hoặc file nguồn người dùng trong Downloads.
