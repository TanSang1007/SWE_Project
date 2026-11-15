# I05 — Còn/hết món theo nguyên liệu (2026-11-07)

Phần chỉ quantity>0 và chưa tiêu hao bên dưới là baseline lịch sử; được [I07](I07_SIZE_RECIPE_CONSUMPTION.md) thay bằng định lượng S/M/L, kho mới tách riêng theo lựa chọn người dùng và reservation/consumption. Semantics của đơn cũ tiếp tục được giữ qua snapshot; không phân loại lại bằng tên món hiện tại.

Người dùng yêu cầu thay tồn sản phẩm nhập tay bằng kiểm tra nguyên liệu, rồi xác nhận áp dụng cho cả Admin, menu và đặt hàng; bỏ giới hạn Product.stock cho7 món dưới đây. Đây là extension người dùng thay quy tắc A06 cho các món đã cấu hình; không sửa PDF hoặc tự thêm định lượng.

| Món | Nguyên liệu bắt buộc |
| --- | --- |
| Cappuccino | Cà phê KG, Sữa tươi L, Đường KG |
| Latte | Cà phê KG, Sữa tươi L, Đường KG |
| Cold brew | Cà phê KG, Sữa tươi L, Đường KG |
| Đen đá | Cà phê KG, Đường KG |
| Asian Dolce Latte | Cà phê KG, Sữa tươi L, Sữa đặc L, Bột quế KG |
| Matcha Coldwisk | Bột matcha KG, Sữa đặc L, Sữa tươi L |
| Cacao đá | Bột ca cao KG, Sữa đặc L |

`Cappuchino` và `Ca cao đá` là alias cho tên người dùng gõ; database hiện có Cappuccino/Cacao đá. Danh sách nằm trong [product-ingredients.ts](../backend/src/catalog/product-ingredients.ts), khớp tên đã chuẩn hóa khoảng trắng/NFC/chữ thường. Đổi tên món ngoài các tên/alias này phải cập nhật cấu hình cùng task. Món khác chưa được cấu hình tiếp tục workflow Product.stock cũ; không tự đoán công thức.

## Quy tắc

- Còn món khi mọi nguyên liệu bắt buộc có bản ghi đúng tên chuẩn hóa/đơn vị và quantity>0. Một nguyên liệu0, chưa tạo hoặc sai đơn vị làm hết món. Ngưỡng cảnh báo sắp hết nguyên liệu không làm hết món:0.001kg vẫn còn.
- Không dùng số Product.stock để giới hạn số ly cho món có cấu hình. Không giả lập một số lượng lớn hoặc suy ra số ly có thể pha. Giới hạn giỏ/qty kỹ thuật hiện có giữ nguyên.
- Chưa có định lượng theo món/size; không trừ, giữ chỗ hoặc hoàn nguyên liệu khi tạo/thanh toán/hủy. Không tự thêm Đá, vật dụng, sốt hoặc topping vào các công thức này.
- Public menu/chi tiết còn kiểm tra isActive và size hợp lệ; giỏ còn kiểm tra size/topping hiện hành. Ngừng kinh doanh và hết nguyên liệu là hai điều kiện khác nhau.
- Admin Tồn sản phẩm hiển thị Còn món/Hết món, danh sách nguyên liệu và tên nguyên liệu hết/chưa có. Không hiển thị số tồn món cũ hoặc form tăng/giảm cho món cấu hình; có link Quản lý nguyên liệu. Nhập hàng/xác nhận hoặc kiểm kê được Admin duyệt cập nhật nguồn tồn; lần đọc kế tiếp tính lại trạng thái.

## Snapshot, giao dịch và đơn cũ

[Migration](../backend/prisma/migrations/20261107110000_product_ingredient_availability/migration.sql) thêm `order_items.ingredient_keys_snapshot TEXT[] NOT NULL DEFAULT '{}'`. Prisma field `ingredientKeysSnapshot`. Không thêm bảng hoặc đổi FK/quan hệ, tiền/loyalty/status/idempotency.

- Mảng rỗng của mọi đơn cũ nghĩa là đã reserve Product.stock: failure/cancel/expiry/paid-cancel hoàn stock theo contract cũ; retry vẫn reacquire stock. Không phân loại lại đơn cũ bằng tên món hiện tại.
- Đơn mới có cấu hình lưu exact normalized-name/unit keys của nguyên liệu. Tạo đơn tăng Product.version bằng CAS để bảo vệ giá/cấu hình, không trừ Product.stock. Failure/cancel/expiry/paid-cancel chỉ hoàn các item snapshot rỗng; không cộng stock cho item không từng reserve. Đơn hỗn hợp giữ đúng hai loại item.
- Create kiểm tra lại nguyên liệu dưới row SHARE lock trong cùng transaction tới commit. Nhập hàng/duyệt kiểm kê update các hàng này nên không commit một đơn mới dựa trên balance đã hết trước commit. Thứ tự owner→nguyên liệu ORDER BY id→Product CAS; ingredient workflows không khóa Product.
- New initiation/retry và confirm-zero kiểm tra lại các keys snapshot dưới SHARE lock sau replay/ownership/state guards. Retry capability đọc cùng balances. Replay đã hoàn tất vẫn trả kết quả cũ, không kiểm tra lại hoặc phát sinh stock/financial effects.
- Callback đã ký hợp lệ tiếp tục settlement theo đơn đã tạo, kể cả nguyên liệu sau đó hết. Không thay HMAC/IPN/QueryDr/network/admission hoặc ép kết quả gateway. UNKNOWN/REVIEW vẫn giữ quy tắc tài chính cũ.

## API và frontend

Không thêm path hoặc quyền. GET `/admin/inventory` giữ các field cũ cho tương thích; item cấu hình thêm `inventorySource:"INGREDIENTS"`, `available:boolean` theo nguyên liệu, `ingredients:[{name,unit,quantity:string|null,available}]`, `missingIngredients:string[]`. Admin product list thêm inventorySource/available cùng nghĩa; UI vẫn kiểm tra isActive/size riêng. Quantity null là thiếu bản ghi đúng đơn vị. UI không dùng legacy stock để suy trạng thái của item này.

Public Catalog DTO giữ nguyên available:boolean, tính từ nguồn mới. Cart item cấu hình bỏ field stock (đã optional trong frontend contract), giữ requestedQuantity và available; không đưa số ly giả vào cảnh báo vượt tồn. Giá/qty/options không đổi. New Cart writes/preview/create khi hết nguyên liệu trả409 OUT_OF_STOCK hiện có. Chứng từ/summary kho nguyên liệu giữ nguyên.

POST adjustment của món cấu hình trả409 INVALID_STOCK_ADJUSTMENT hiện có; exact replay lịch sử được xét trước chính sách mới để giữ recovery. Snapshot nguyên liệu là dữ liệu nội bộ, không thêm vào Order public DTO hoặc nhận từ input client.

## Triển khai và acceptance

Fallback hẹp [apply-product-ingredients.cjs](../backend/scripts/apply-product-ingredients.cjs) kiểm tra chain/checksum, column presence, transaction và fingerprint mọi bảng. Fingerprint OrderItem loại riêng cột mới; mọi row cũ phải có mảng rỗng. Không seed/update stock, nguyên liệu hoặc trạng thái đơn:

```powershell
node backend/scripts/apply-product-ingredients.cjs --check
node backend/scripts/apply-product-ingredients.cjs --apply
npm.cmd run db:generate --workspace backend
```

Các backend cùng dùng Neon cần cập nhật code đồng bộ trước khi cùng xử lý đơn mới có snapshot nguyên liệu; backend cũ không hiểu field này và có thể hoàn Product.stock sai. Không kill/restart callback hoặc thay trạng thái giao dịch để triển khai. Migration không tự nhập nguyên liệu; các mục tồn0 tiếp tục làm món hết cho tới khi có phiếu nhập/kiểm kê thật.

Acceptance: đủ7 công thức; mỗi nguyên liệu bắt buộc hết làm món hết; nhập lại làm món còn; thiếu/sai đơn vị không được coi còn; Product.stock0 không chặn nếu nguyên liệu còn; stock100 không cho bán khi nguyên liệu hết; public/menu/cart/Admin đồng nhất; không nhận manual adjustment mới cho món cấu hình; create/replay/cancel/zero/failure/retry không tạo stock giả hoặc sửa tồn nguyên liệu; đơn cũ còn phục hồi Product.stock đúng một lần.

Đã kiểm chứng:

- Backend204 kiểm tra thuộc10 suite liên quan PASS qua các lượt chạy: recipe helper, pricing, Cart, Admin products/inventory, Catalog errors, Order, Cart/payment preservation, zero confirmation và IPN. Lượt đầu có3 lỗi Cart unit fixture thiếu product.name; đã bổ sung tên fixture và chạy lại22/22 PASS, cùng Admin products/recipe76/76 PASS. Không nới validation runtime để bỏ qua nguyên liệu.
- PostgreSQL local recipe14/14 và Catalog21/21 PASS. Recipe suite kiểm tra7 món/manual0, thiếu/hết/nhập lại, Cart/Admin/quyền/manual adjustment, snapshot cũ và đơn hỗn hợp, lock race, create replay sau cancel, không lộ keys, zero/paid-cancel, verified gateway failure và retry. Catalog seed không nhập nguyên liệu nên Cappuccino/Latte phải unavailable theo quy tắc mới; đã cập nhật assertion. Seed child process ban đầu bị sandbox EPERM; chạy lại ngoài giới hạn spawn được duyệt thì21/21 PASS.
- Frontend78/78 PASS cho Admin inventory/products, Catalog, Cart và Checkout; gồm metadata/render còn-hết theo nguyên liệu và không hiển thị số ly cũ. Frontend/backend TypeScript và lint source/test/script liên quan PASS. Backend build cô lập và Next production build PASS qua browser harness; không thay cấu hình runtime để test.
- Edge headless20/20 luồng PASS: hồi quy nhập/kiểm kê/phân quyền và7 công thức; stock0 của Latte vẫn còn món khi đủ nguyên liệu; Đường0 làm đúng4 món hết ở Admin/public menu,0.001kg phục hồi; không form điều chỉnh stock cho các món này. Không runtime exception hoặc tràn ngang toàn trang1366/390px. Đã xem ảnh Admin recipe inventory1366px.
- Evidence ignored: `.brewlite/ingredients-browser-87a000a1e367423cb4d28bee99c0655d/` có result.json, ảnh và build/server logs; browser harness dọn database/profile test. Không nhập lượng hoặc thanh toán thử trên Neon.
- Migration I05 đã áp dụng trên Neon development, fingerprint31 bảng giữ nguyên field nghiệp vụ; snapshot cũ có default mảng rỗng. `--check` chạy lại xác nhận đã áp dụng, không thay dữ liệu. Read-only so sánh live `/products` với kho thật khớp7/7; tại lúc kiểm tra5 món available, Asian Dolce Latte/Matcha Coldwisk unavailable theo kho. Backend watch nhận source mới; không kill/restart runtime hay callback của người dùng.
- Kiểm tra diff/cú pháp script và12 liên kết tài liệu mới PASS. Các thay đổi trước trong workspace được giữ nguyên; không sửa PDF hoặc `.env`.

Giới hạn kiểm chứng: lượt PostgreSQL mở rộng có lỗi ở các suite Cart/A06 cũ: fixture Cart đăng nhập thiếu Origin/CSRF nên403, A06 còn cấu hình MOCK/endpoint thanh toán cũ nên create503. Không sửa các fixture auth/payment đó trong task này và không tuyên bố toàn suite PostgreSQL PASS. Lượt đầu recipe thiếu trường/binding OrderInfo của callback synthetic đã được sửa đúng requestParameters rồi chạy lại recipe14/14 PASS; không sửa signing/verification runtime. Có cảnh báo `pg` query concurrency và log lỗi dự kiến trong fault suites như các đợt trước. Chưa chạy toàn bộ backend suite, giao dịch VNPAY thật hoặc kiểm tra mọi máy dùng chung Neon.
