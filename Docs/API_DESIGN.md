# BrewLite — REST API

I03 amendment2026-10-29: POST `/ingredient-inventory/catalog/initialize`, ADMIN JWT/current DB role, strict body/query rỗng,200 `{created,existing}`; private/no-store/Vary Authorization/Origin. Bảo đảm12 mặt hàng tồn tại qua normalizedName unique/transaction/skipDuplicates/post-check; retry không nhân đôi hoặc thay tồn.409 INGREDIENT_UNIT_MISMATCH khi tên có sẵn sai đơn vị, rollback toàn bộ. Không Idempotency-Key cho thao tác cố định này. Frontend Admin gọi khi đọc lại kho/nhập hàng, Staff không gọi. `POST /ingredients` tạo mới chấp nhận thêm EGG (quả) threshold10; EGG thuộc nguyên liệu và chỉ nhận số nguyên trong receipt/count. Read DTO units có thể là EGG. Permission/error khác giữ nguyên. [Danh mục và quy tắc](I03_RECEIVING_CATALOG.md).

I02 amendment2026-10-29: `POST /ingredient-inventory/ingredients` nhận `{name,unit}` mới với unit PIECE/L/KG; backend tự đặt lowStockThreshold tương ứng10/5/10. Field lowStockThreshold cũ tùy chọn, chỉ cho request mới nếu bằng chính sách; khác trả400 VALIDATION_ERROR. G/ML chỉ còn hỗ trợ exact replay request tạo cũ, đọc và các phiếu cho dữ liệu đã có; tạo mới trả400. Exact replay key/hash lịch sử được xét trước chính sách mới. DTO reads giữ nguyên; status LOW_STOCK khi0<quantity<threshold, IN_STOCK khi quantity>=threshold, OUT_OF_STOCK khi0. Summary dùng cùng ranh giới. Không đổi permission, API path hoặc contracts nhập/kiểm kê/duyệt. [I02](I02_INVENTORY_CATEGORIES.md).

## I01 — API nguyên liệu (user extension2026-10-29)

Base `/ingredient-inventory`; JWT/current DB role qua guards hiện có. Mọi response private/no-store, Vary Authorization/Origin. Không thay API cũ. [Contract](I01_INGREDIENT_INVENTORY_CONTRACT.md).

| Endpoint | Quyền, input và kết quả |
| --- | --- |
| GET /ingredient-inventory/summary | STAFF/ADMIN, body/query rỗng;200 {totalIngredients,inStock,lowStock,outOfStock,pendingCounts}, số nguyên không âm. Aggregate toàn database; pendingCounts của Staff chỉ phiếu của mình, Admin toàn bộ; không giới hạn bởi trang lịch sử50 dòng |
| GET /ingredient-inventory/ingredients | STAFF/ADMIN, body/query rỗng;200 {items}, mỗi nguyên liệu có id/name/unit/quantity/lowStockThreshold/version/status, createdBy/updatedBy và timestamps; không credentials |
| POST /ingredient-inventory/ingredients | ADMIN; Idempotency-Key bắt buộc, name1..120 không trống, unit PIECE/L/KG/EGG cho tạo mới, lowStockThreshold cũ tùy chọn theo amendment I02/I03;201 id. Tồn ban đầu0 |
| POST /ingredient-inventory/catalog/initialize | ADMIN; body/query rỗng;200 {created,existing}, bảo đảm12 mặt hàng của I03 tồn tại, không đổi tồn/hàng cũ;409 INGREDIENT_UNIT_MISMATCH khi đơn vị khác |
| GET /ingredient-inventory/receipts | ADMIN; query cursor UUID tùy chọn, body rỗng;200 items/nextCursor, kèm lines/actor/movement |
| POST /ingredient-inventory/receipts | ADMIN; key bắt buộc, note tùy chọn<=500, lines1..50 distinct {ingredientId,quantity>0};201 DRAFT, chưa ghi tồn |
| POST /ingredient-inventory/receipts/:id/confirm | ADMIN; {expectedVersion};200 CONFIRMED, một lần cộng tồn và audit. Replay resource đã CONFIRMED không cộng lần nữa |
| GET /ingredient-inventory/counts | STAFF chỉ own; ADMIN toàn bộ; cursor UUID,200 items/nextCursor, snapshot/difference/current/stale/notes/reviewer/replacement |
| POST /ingredient-inventory/counts | STAFF; key bắt buộc; note<=500, recountOfId tùy chọn; lines1..50 distinct {ingredientId,expectedVersion,actualQuantity>=0,note<=500}. Backend tự lấy baseline;201 SUBMITTED, không ghi tồn |
| POST /ingredient-inventory/counts/:id/review | ADMIN; {expectedVersion,action:APPROVE/REJECT/REQUEST_RECOUNT,note<=500}.200 resource; reject/recount note không trống. Approve stale trả409, không rebase/overwrite |
| GET /ingredient-inventory/movements | ADMIN; cursor UUID,200 items/nextCursor gồm before/after/delta/actor/time/source |

Quantity là chuỗi VND-independent thập phân không âm, tối đa9 chữ số nguyên và3 chữ số lẻ, không exponent/comma/rounding; UI chuyển dấu phẩy trước khi gửi. PIECE phải nguyên. expectedVersion integer0..2147483646; id UUID. GET tài liệu tối đa50 records với cursor kế tiếp; mutations query rỗng. Không nhận actor/status/stock/difference từ client.

Errors envelope cũ:400 VALIDATION_ERROR/MISSING_IDEMPOTENCY_KEY;401 UNAUTHORIZED;403 FORBIDDEN;404 INGREDIENT_NOT_FOUND/DOCUMENT_NOT_FOUND (gồm recount của người khác);409 INGREDIENT_EXISTS/IDEMPOTENCY_KEY_REUSED/INVALID_DOCUMENT_STATE/INVENTORY_CHANGED/CONCURRENT_UPDATE, overflow INVALID_QUANTITY;422 INVALID_QUANTITY cho zero receipt/fractional PIECE;503 SERVICE_UNAVAILABLE sanitized. Client giữ key/body khi network/503/concurrent chưa rõ; không tự tạo key mới. Review lặp cùng action/note đã terminal trả resource, action/note khác409. Không endpoint Staff mutation tồn chính thức.

**Amendment được người dùng duyệt 2026-10-22:** [Checkout/session contract](CHECKOUT_SESSION_UPDATE.md) supersede Cart lock/success-clear, Attempt900s và auth không khôi phục phiên ở các baseline lịch sử dưới đây. API mới: GET /orders/active; POST /orders/:id/payment-resume; POST /auth/session, POST /auth/logout. Order DTO bổ sung deadline/server clock; login thêm HttpOnly session và CSRF/origin check. Không thay permission Customer/Admin/Staff hoặc verified-IPN settlement.

Clarification2026-10-26: session cookie sai cấu trúc UUID trả401 UNAUTHORIZED tại POST `/auth/session` trước SQL; POST `/auth/logout` vẫn200 và xóa cookie lỗi sau Origin/CSRF check. Đây là sửa thực thi invalid-session contract, không thêm path/DTO/quyền. `PAYMENT_TIMEOUT` vẫn409; frontend đọc lại Order và giải phóng Mock intent bị từ chối, không tự xác nhận financial outcome.

Order review2026-10-27: `GET /orders/active` trả200 `{order: <owned detail>|null, serverNow}`, chỉ CUSTOMER/current DB role, strict empty body/query, private/no-store và Vary Authorization/Origin; lỗi đọc Order trả503 SERVICE_UNAVAILABLE với envelope đã làm sạch, thống nhất GET detail/history. Auth lookup error vẫn theo contract auth hiện có. Customer cancel lọc owner ngay trong SELECT FOR UPDATE: missing/cross-owner luôn404 ORDER_NOT_FOUND kể cả khi đơn của người khác đang khóa; không chờ khóa đơn đó rồi trả409. Nhánh expiration nội bộ trả đúng `paymentExpiredAt` vừa lưu nhưng vẫn giữ PENDING/reservations khi gateway chưa rõ; không thêm tham số timeout ở HTTP hoặc thay settlement.

Tài liệu mô tả contracts hiện có; các bảng baseline/mock được bổ sung bằng gateway/loyalty/operator contracts. Blueprint PLANNED trong A00/P00 không tự trở thành endpoint đã triển khai. Source controllers là mapping hiện tại, [Traceability](TRACEABILITY_MATRIX.md) ghi phạm vi nghiệm thu.

## Gateway và Loyalty — mapping hiện hành

| API | Quyền / hành vi |
| --- | --- |
| GET /payments/config | CUSTOMER JWT/current DB role; private no-store; `{providerMode:"MOCK"}` hoặc `{providerMode:"VNPAY_SANDBOX"} khi m?, th?m acceptingNewPayments:false khi ??ng`; không lộ merchant/key/URL; config sai 503, không fallback MOCK |
| POST /payments/vnpay/attempts | CUSTOMER/owned Order, Idempotency-Key, body `{orderId}`; kiểm tra state/reservation/profile/minimum/admission; tạo/replay intended Attempt, không settle |
| GET /payments/attempts/:attemptId | CUSTOMER owner; normalized state/capabilities, không raw provider evidence |
| GET /orders/:id/payment-attempts | CUSTOMER owner; bounded cursor history/capabilities |
| GET /payments/vnpay/ipn | Public raw callback; HMAC/binding verification; provider ACK; durable T1 receipt và atomic T2 effects |
| GET /payments/vnpay/return | Public read-only; verify context rồi 303 tới fixed result local; không settlement/receipt/QueryDr |
| POST /orders/:id/confirm-zero | CUSTOMER owner/key, strict empty body/query, exact PENDING total0; explicit INTERNAL_ZERO Payment0/Award0/EARN0, không gateway |
| POST /admin/payments/vnpay/attempts/:id/reconcile | ADMIN/direct loopback/strict empty input; verified evidence recovery; external QueryDr transport OFF, không scheduler/retry/batch |
| POST /orders/preview | CUSTOMER, read-only server pricing/promotion/redemption preview |
| GET /loyalty và /loyalty/transactions | CUSTOMER own available/held/debt/rate và bounded journal history; không public mutation |

New positive VNPAY create/initiation/retry trong DRAIN_ONLY trả 503 `PAYMENT_ADMISSION_CLOSED`, không commit claim/reservation/new URL. Exact historical replay xét trước admission; IPN/Return/status vẫn hoạt động dưới profile cũ. `canResume/canRetry` false khi drain. Minimum final positive total là 5.000 VND: 422 `VNPAY_MINIMUM_AMOUNT_NOT_MET`; zero đi explicit internal flow, callback không bị lọc theo policy minimum mới.

Return chỉ thêm `attemptId` khi verified/bound, còn lại generic result; no-store/no-referrer, không token/signature/status/URL client. FRONTEND_ORIGIN local được pin; URL đăng ký VNPAY không được thay từ query. Result hiện đã có frontend, đọc authenticated status rồi mới báo success/cancel/unresolved. Hủy gateway không tự hủy Order.

Loyalty extension thêm `redeemedPoints` (mặc định0), snapshot discount/state vào Order/Payment, balance available/held/debt và cursor history; legacy payload0/hash/replay giữ đúng contract. Promotion trước rồi điểm; cancellation/debt theo [L00](L00_LOYALTY_REDEMPTION_CONTRACT.md).

Chi tiết DTO/error/cursor/binding: [initiation](P01B2A_VNPAY_INITIATION_IMPLEMENTATION.md), [IPN](P01B2B_VNPAY_IPN_SETTLEMENT_IMPLEMENTATION.md), [Return](P01C1_VNPAY_BROWSER_RETURN.md), [Checkout](P01C2_VNPAY_CUSTOMER_CHECKOUT.md), [zero](P01B2C2_ZERO_TOTAL_INTERNAL_CONFIRMATION.md), [reconcile](P01B2C1_VNPAY_QUERYDR_RECONCILIATION.md). Không thêm/đổi API trong lần chuẩn bị tài liệu.

## 1. Quy ước

- REST/JSON, URL tương đối root backend, chưa thêm `/api/v1` để giữ nguyên endpoint trong đề. Base URL là cấu hình frontend.
- Request/response camelCase; ID UUID; thời gian ISO 8601; tiền VND là chuỗi số nguyên (`"45000"`), qty/points/version là JSON number trong giới hạn INTEGER.
- Header private: `Authorization: Bearer <JWT>`. Server lấy user từ JWT, không nhận userId để đặt/thanh toán thay người khác.
- `Content-Type: application/json`. Request chỉ có trường cho phép; reject trường dư nhạy cảm như total/status/loyaltyPoints. Payload tối đa 64 KiB; vượt trả 413 PAYLOAD_TOO_LARGE theo Q19.
- Lỗi chung: `{ "error": { "code": "OUT_OF_STOCK", "message": "Sản phẩm không đủ số lượng", "details": [], "requestId": "..." } }`. Không lộ stack trace, passwordHash, token hay dữ liệu đơn khác.
- HTTP 400: DTO sai; 401: thiếu/sai/hết hạn JWT; 404: không tìm thấy hoặc order không thuộc user; 409: xung đột trạng thái/idempotency/tồn; 422: policy nghiệp vụ không thỏa (mã không hợp lệ); 500/503: lỗi kỹ thuật/khả năng phục vụ, không mặc định coi là thanh toán bị từ chối.
- Bounds kỹ thuật Q19: items 1..50 sau gộp, qty 1..99 mỗi dòng sau gộp, toppingIds 0..10 ID khác nhau; promotionCode 1..32 ký tự trim/uppercase. Money 0..999.999.999.999 VND, stock/points/version 0..2.147.483.647; reject vượt biên trước ghi, 400 VALIDATION_ERROR. Đây là giới hạn kỹ thuật, không business requirement PDF.
- Auth/key/timeout đã chốt Q12/Q19. Không endpoint admin hoặc payment webhook.

## 2. Danh mục API và quyền

B14/D34 is a user-approved read-only extension: GET /loyalty exposes current stored balance. It is the sole exception to D32's earlier prohibition on inferred Loyalty endpoints; B11 award rules and B15/B16 boundaries remain unchanged. Detailed contract is below.

| Method + path | Quyền | Chức năng | Nguồn |
| --- | --- | --- | --- |
| GET /products | Public | Menu | Bắt buộc FR01 |
| GET /products/:id | Public | Chi tiết và tùy chọn | Bắt buộc FR02 |
| POST /auth/register | Public | Đăng ký | Bắt buộc FR04 |
| POST /auth/login | Public | Đăng nhập, JWT | Bắt buộc FR05 |
| GET /loyalty | JWT customer | Số dư điểm hiện tại của user từ PostgreSQL | B14 user-approved extension D34 hỗ trợ FR16 |
| GET /cart | JWT customer | Giỏ đã lưu của user hiện tại | B08 user decision, FR03 |
| POST /cart/items | JWT customer | Thêm/merge cấu hình với giá DB | B08 user decision, FR02/03 |
| PATCH /cart/items/:id | JWT owner | Sửa qty only | B08 user decision, FR03 |
| DELETE /cart/items/:id | JWT owner | Xóa dòng giỏ | B08 user decision, FR03 |
| POST /orders | JWT customer | Tạo PENDING từ giỏ, áp mã nếu có, kiểm soát tồn | Bắt buộc FR06/14/15 |
| POST /payments | JWT owner của order | Thanh toán idempotent | Bắt buộc FR07/08/13/16 |
| GET /orders/me | JWT customer | Lịch sử chỉ của user hiện tại | Bắt buộc FR10 |
| GET /orders/:id | JWT owner | Đọc lại snapshot/trạng thái cho xác nhận, retry sau mất response | Đề xuất hỗ trợ FR09/10, không phải chức năng mới |
| POST /orders/:id/cancel | JWT owner | Hủy unpaid và hoàn tồn một lần | Thiết kế hỗ trợ FR12/14, Q06/Q09 |

Định tuyến `/orders/me` trước `/:id`, validate UUID để tránh hiểu `me` là ID. Cart API bổ sung theo user decision B08 tại §13; persistence client cũ SUPERSEDED. Không có API cộng điểm trực tiếp; khuyến mãi nằm trong tạo đơn, không cần API quản trị promotion.

## 3. Catalog

### GET /products

Không có filter/search/pagination bắt buộc trong menu mẫu.

200:

```json
{
  "items": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Cappuccino",
      "price": "45000",
      "imageUrl": "/images/cappuccino.jpg",
      "available": true
    }
  ],
  "currency": "VND"
}
```

Menu rỗng: `items: []`, không trả lỗi. `available` là dữ liệu hỗ trợ UI đề xuất, không cam kết giữ tồn; backend kiểm tra lại khi đặt. Không nhất thiết công khai số lượng stock.

`imageUrl` dạng `/images/...` thuộc **frontend origin**, tương ứng `frontend/public/images/`; không nối vào backend base URL. Không thêm upload service.

### GET /products/:id

200 gồm các trường menu và `sizes: [{ "size": "S", "extraPrice": "0" }, ...]`, `toppings: [{ "id": "...", "name": "Kem", "price": "5000" }]`. Giá trả từ DB; số trong ví dụ là seed/demo, không business constant. 400 nếu ID không hợp lệ, 404 nếu không có sản phẩm.

Client chỉ được chọn size/topping API này cho phép, nhưng server vẫn validate khi tạo đơn. Q04: itemPrice = baseProductPrice + sizeExtraPrice + sum(toppingPrice); lineTotal = itemPrice * qty. Server tính lại từ DB, không hard-code.

## 4. Auth

### POST /auth/register

Request: `{ "email": "customer@example.com", "password": "<mật khẩu mẫu đáp ứng policy>" }`.

- Validate email tối đa 254 ký tự, trim/lowercase; password 8–72 byte UTF-8, không trim/cắt ngầm; bcrypt cost 10 theo Q12.
- 201 A01: `{ "user": { "id": "...", "email": "customer@example.com", "loyaltyPoints": 0, "role": "CUSTOMER" } }`; request vẫn email/password only, role=STAFF/ADMIN hoặc field dư400 VALIDATION_ERROR, register explicit CUSTOMER.
- 400: `VALIDATION_ERROR`; 409: `EMAIL_ALREADY_EXISTS` (DB unique xử lý cả register đồng thời).
- Không auto-login; sau đăng ký tới login, giữ giỏ. Không trả passwordHash.

### POST /auth/login

Request cùng hai trường email/password. 200 A01: `{ "accessToken": "<JWT>", "tokenType": "Bearer", "expiresIn": 3600, "user": { "id": "...", "email": "customer@example.com", "loyaltyPoints": 0, "role": "CUSTOMER" } }`. Login role lấy DB, CUSTOMER/STAFF/ADMIN đều dùng B07; no hash, JWT vẫn sub/iat/exp, không authoritative role claim. JwtStrategy reread DB role mỗi protected request; old token/forged claim không override DB permission.

JWT HS256 TTL 3.600 giây, sub=user.id, token chỉ memory; reload login lại. Đây là quyết định kỹ thuật Q12. 401 `INVALID_CREDENTIALS` dùng thông báo chung cho email không có hoặc mật khẩu sai. Không refresh/logout server/reset-password API. Logout UI chỉ xóa token local.

## 5. Orders

### B13 Promotion acceptance clarification

Existing POST /orders promotionCode flow is completed/tested under [B13](B13_PROMOTION_CONTRACT.md). No Promotion preview/list/CRUD endpoint or role added. DB eligibility: code exists, active, startsAt <= now < endsAt, subtotal >= minimumSubtotal. Existing configured discount CHECK>0 remains; omission produces discount0. Invalid Promotion configuration/eligibility returns422 PROMOTION_INVALID, malformed code400 VALIDATION_ERROR. Pricing uses Decimal/min/max0 and Order snapshots; Payment/transport replay never revalidate or reprice Promotion. No request/response/path/permission change.

### B10 implementation clarification — accepted user decision

POST /orders, GET /orders/:id and POST /orders/:id/cancel are implemented; no new endpoint. Create uses mandatory JWT/Idempotency-Key, baseline DTO/201 snapshot and PENDING status. Normalize UUID lower-case/trim, size upper-case/trim, topping set order; reject duplicate toppings and non-integer qty, merge identical configurations (qty<=99, configurations<=50 after merge), sort configs; raw payload remains limited64KiB. Full normalized request must equal current PostgreSQL Cart; mismatch409 CONCURRENT_UPDATE, no writes. Optional promotionCode uses existing DB policy; null/empty invalid, omission means zero discount. Money computed by B09 in creation transaction, response strings. orderCode uses BL- plus UUID (example BL-1042 below remains illustrative).

One active unpaid order/user (PENDING or PAYMENT_FAILED). Completed idempotency replay checked first, independent of current Cart/catalog/active state. New key blocked409 INVALID_ORDER_STATE, error envelope details is `{ "existingOrderId": "<owned UUID>" }`; other errors retain details string-array convention. No other owner's ID exposed. Missing key400 MISSING_IDEMPOTENCY_KEY; invalid key/merged bounds400 VALIDATION_ERROR; in-progress409 IDEMPOTENCY_IN_PROGRESS; technical rollback503 SERVICE_UNAVAILABLE with sanitized message. Replay201 includes Idempotency-Replayed:true.

Create preserves Cart. All three Cart writes are blocked409 INVALID_ORDER_STATE with existingOrderId while active unpaid exists; GET /cart response unchanged. UI displays PENDING snapshot, disables editing after discovery, offers existing GET/cancel. If UX cache is absent, blocked POST /orders or blocked Cart write discovers existingOrderId. No automatic create request just to probe. Cancel returns200 current detail: PENDING restore snapshot qty once, PAYMENT_FAILED no second restore, repeated CANCELLED no-op; stock/status/version update atomically, Cart preserved. After cancel Cart writes unlock. B10 does not implement payment, paid cancel or history list.

### POST /orders

JWT và `Idempotency-Key` bắt buộc theo Q07 cho CREATE_ORDER; PDF chỉ chỉ rõ key payment. Dùng chung helper/bảng claim với PAY_ORDER, namespace độc lập.

Request:

```json
{
  "items": [
    {
      "productId": "11111111-1111-4111-8111-111111111111",
      "size": "M",
      "qty": 2,
      "toppingIds": ["22222222-2222-4222-8222-222222222222"]
    }
  ],
  "promotionCode": "BREW10K"
}
```

Không có total, unitPrice, discountAmount, points, status hay userId trong request. `promotionCode` tùy chọn; `toppingIds` cho phép mảng rỗng. Không có topping trùng; option phải thuộc product. Bounds kỹ thuật tại §1 áp dụng trước ghi và sau gộp cấu hình.

201, ví dụ với base 45.000, phụ thu M 5.000, Kem 5.000, qty 2, giảm cố định 10.000 (toàn bộ giá/promo là fixture minh họa):

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "orderCode": "BL-1042",
  "status": "PENDING",
  "currency": "VND",
  "items": [
    {
      "productId": "11111111-1111-4111-8111-111111111111",
      "productName": "Cappuccino",
      "size": "M",
      "qty": 2,
      "unitPrice": "55000",
      "lineTotal": "110000",
      "toppings": [{ "name": "Kem", "price": "5000" }]
    }
  ],
  "subtotal": "110000",
  "discountAmount": "10000",
  "total": "100000",
  "promotionCode": "BREW10K",
  "createdAt": "2026-10-05T14:00:00Z"
}
```

Mã đơn hiển thị/UUID là hai khái niệm riêng; không dựa orderCode để cấp quyền. Lỗi: 400 `INVALID_ITEM_OPTIONS`/`VALIDATION_ERROR`; 409 `OUT_OF_STOCK`/`CONCURRENT_UPDATE`/`IDEMPOTENCY_KEY_REUSED`; 422 `PROMOTION_INVALID`. Khi lỗi trước commit không có đơn/stock một phần.

### GET /orders/me

B15 implements this baseline endpoint before the UUID detail route. JWT ownership comes only from req.user.id. No query/body fields (including userId/status/limit/offset/cursor); invalid fields400 VALIDATION_ERROR, missing/invalid/expired JWT401 UNAUTHORIZED. Service selects only summary fields and stored award contribution, no Cart/Product repricing or writes. Read faults503 SERVICE_UNAVAILABLE use the existing sanitized envelope; auth-lookup faults retain existing500. Cache-Control: private, no-store, max-age=0 and Vary: Authorization preserve CORS Vary: Origin; frontend fetch no-store. [B15 contract/evidence](B15_ORDER_HISTORY_CONTRACT.md).

200: `{ "items": [<order summary>] }`; summary gồm id, orderCode, status, total, currency, createdAt, earnedPoints hiện tại như GET detail. Không có đơn thì items rỗng.

Trả các đơn của user theo `(createdAt DESC, id DESC)` với dataset demo nhỏ; không cursor/limit/nextCursor theo scope DECISIONS. Query luôn có userId từ JWT.

### GET /orders/:id — endpoint hỗ trợ đề xuất

B15 reuses the existing snapshot/detail projection without adding fields. Both private read routes reject query/body options, return no-store and expose no user/Payment IDs/keys/raw rows. /orders/[id]/confirmation reads this endpoint on entry/Retry and after re-login; viewing never creates an Order or replays Payment. paidAt/paymentStatus are detail metadata; the seven-field history summary above retains its designed shape.

200 trả snapshot Order tương tự tạo đơn, thêm `paidAt`, `earnedPoints`, và `paymentStatus` tổng quát khi có payment. Chỉ trả dữ liệu của owner. 404 chung cho không tồn tại/không sở hữu. earnedPoints là contribution hiện tại của order: NULL khi chưa PAID và chưa award (PENDING/PAYMENT_FAILED); bằng award.points khi reversed_at NULL (có thể 0); bằng 0 cho CANCELLED dù từng PAID hoặc chưa award. COMPLETED giữ points đã cấp, không cấp thêm. Không trả points gốc đã thu hồi thành điểm đang hưởng.

Xác nhận đọc lại endpoint này để trạng thái hiển thị là trạng thái hiện tại. Không suy ra đã thanh toán từ query URL hay state client. `paymentStatus` của lần thử gần nhất khác `Order.status` (ví dụ SUCCEEDED trong khi order đang PREPARING).

## 6. Payment

### B11 implementation — confirmed D32

POST /payments is implemented with the contract below, no new path/DTO/method/status. Server startup validates PAYMENT_MOCK_MODE=SUCCESS (default) or FAILURE; restart backend to change demo mode, tests inject results. Payment/Order/stock/Cart/award/balance/claim response commit atomically under the same user lock as Cart/create/cancel. Common key/replay helper shared with create. Success clears only owner's purchased snapshot configurations/qty (extra qty/configurations preserved); failure/retry follow baseline below. Minimal PAID award/balance moved from B14 into B11 under user decision D32; internal paid-cancel/reversal remains B16. Existing schema/partial success unique and award unique unchanged. Explicit503 PAYMENT_UNAVAILABLE is preserved by the filter with a fixed sanitized message; protocol error contract unchanged. [B11 evidence](B11_PAYMENT_CONTRACT.md).

### POST /payments

JWT và header `Idempotency-Key` bắt buộc theo PDF. Request: `{ "orderId": "33333333-3333-4333-8333-333333333333", "method": "WALLET" }`; method cho phép `WALLET` hoặc `CARD`.

Server lấy amount từ đơn, không nhận thông tin thẻ thật hoặc kết quả thanh toán do khách gán. Key gồm 1..128 ký tự ASCII hiển thị theo Q19, client nên sinh UUID; áp dụng cả CREATE_ORDER và PAY_ORDER. Mock server deterministic SUCCESS/FAILURE theo Q15, tests inject kết quả; không delay ngẫu nhiên/client success flag. Total=0 dùng cùng mock.

200 khi mock có kết quả nghiệp vụ xác định:

```json
{
  "payment": {
    "id": "44444444-4444-4444-8444-444444444444",
    "orderId": "33333333-3333-4333-8333-333333333333",
    "status": "SUCCEEDED",
    "amount": "100000",
    "method": "WALLET"
  },
  "order": {
    "id": "33333333-3333-4333-8333-333333333333",
    "orderCode": "BL-1042",
    "status": "PAID"
  },
  "loyalty": { "awardedPoints": 10 }
}
```

Q11/DR14 đã chốt floor(finalAmount/10000) tại PAID: finalAmount 100.000đ tương ứng 10 điểm. Payment, PAID, award và balance cùng transaction. awardedPoints ở response/replay là điểm cấp tại thời điểm request đó, không contribution hiện tại sau internal cancel. GET order cho current earnedPoints; không award ở COMPLETED/API loyalty mới.

Payment bị từ chối cũng HTTP 200 vì request đã được xử lý với kết quả xác định: `payment.status = FAILED`, `payment.failureCode = MOCK_DECLINED`, `order.status = PAYMENT_FAILED`, `loyalty.awardedPoints = 0`. Client phải kiểm tra business status, không chỉ HTTP 2xx, và giữ giỏ. Không có award DB cho lần thất bại.

Lỗi protocol/authorization khác failure nghiệp vụ:

| HTTP/code | Ý nghĩa | Client nên làm |
| --- | --- | --- |
| 400 MISSING_IDEMPOTENCY_KEY / VALIDATION_ERROR | Request không đúng contract | Sửa request; không gọi charge |
| 401 UNAUTHORIZED | JWT không hợp lệ | Login rồi đọc lại trạng thái đơn |
| 404 ORDER_NOT_FOUND | Đơn không tồn tại/không thuộc user | Không tiết lộ owner; không thanh toán |
| 409 IDEMPOTENCY_KEY_REUSED | Key cũ với order/method khác | Không tự tái sử dụng key; phân biệt thao tác mới với retry |
| 409 IDEMPOTENCY_IN_PROGRESS | Request cùng key chưa có kết quả do chờ quá thời gian | Retry cùng key sau khoảng chờ; không tạo checkout mới |
| 409 ORDER_ALREADY_PAID | Key mới trên PAID/PREPARING/READY/COMPLETED đã có success | Đọc lại đơn, hiển thị kết quả; không charge |
| 409 INVALID_ORDER_STATE | CANCELLED/terminal hoặc trạng thái không cho thanh toán | Đọc trạng thái; không ép chuyển |
| 409 OUT_OF_STOCK / CONCURRENT_UPDATE | Không giữ lại được tồn khi retry hoặc CAS conflict | Đọc lại đơn; báo người dùng, không tự tạo order khác |
| 503 PAYMENT_UNAVAILABLE | Lỗi kỹ thuật chưa có kết quả nghiệp vụ commit | Retry cùng key/đọc lại đơn; không coi là PAYMENT_FAILED |

## 7. Hợp đồng idempotency và retry

| Tình huống | Hành vi đề xuất |
| --- | --- |
| Cùng user + operation + key + payload, kết quả đã commit | Trả nguyên HTTP status/body đã lưu; thêm header `Idempotency-Replayed: true`; không ghi side effect mới |
| Cùng key nhưng payload đổi | 409; không charge, không sửa order |
| Cùng key nhưng operation khác | Hai namespace độc lập; POST /orders và POST /payments không đụng nhau |
| User khác dùng cùng chuỗi key | Scope độc lập, vẫn kiểm tra ownership |
| Cùng key đồng thời | Unique DB phân xử; chờ kết quả/đọc lại, timeout → in-progress retryable |
| Payment FAILED được replay | Vẫn FAILED; một lần thử mới phải dùng key mới trên cùng order |
| Muốn đổi phương thức sau FAILED | Key mới với method mới, qua PAYMENT_FAILED → PENDING trước payment |
| Mất response nhưng có thể đã PAID | Dùng lại key/payload cũ; không tạo key/order mới do timeout |
| POST /orders được retry khi order đã PAID | Replay body PENDING ban đầu là đúng hợp đồng; đọc GET /orders/:id để biết trạng thái mới nhất |

Payment endpoint **không tạo order**. Test “hai lần cùng key chỉ tạo một đơn” xác nhận cùng orderId, một Order và một Payment success. Q07 đã chốt thêm test POST /orders cùng key tuần tự/song song chỉ một Order, bên cạnh payment không lặp attempt/award.

Client lưu key/payload/userId/orderId/cart snapshot vào sessionStorage cùng tab trước request; retry vận chuyển giữ nguyên key/payload. Reload login lại và resume chỉ cùng user; khác user xóa context cũ. Không lưu JWT cùng giỏ. Xóa key cũ chỉ khi bắt đầu hành động nghiệp vụ mới đã xác định.

Thứ tự server: JWT + syntax validation → kiểm tra ownership nếu có order → claim/hash/replay → kiểm tra nghiệp vụ cho request mới → thực hiện transaction. Không kiểm tra stock, mã còn hạn hoặc khả năng thanh toán hiện tại trước replay. Ví dụ payment PAID cũ phải replay thành công dù đơn hiện tại đã PREPARING; GET order trả PREPARING. Replay thất bại cũ cũng không được ghi đè đơn đã PAID bởi một lần thử mới.

Claim, business writes và replay cùng transaction; PROCESSING không commit riêng. Q19: pool wait 50 ms, transaction deadline 400 ms, DB lock/statement timeout 200/300 ms. Unique conflict/timeout rollback trước rồi đọc replay một lần bằng transaction mới; chưa có kết quả trả 409 IDEMPOTENCY_IN_PROGRESS. Không tự retry transaction/job. Client timeout 5 giây không chứng minh rollback. CORS cho Authorization/Content-Type/Idempotency-Key, expose Idempotency-Replayed.

## 8. Hợp đồng checkout phía UI

1. Khách có giỏ, login nếu cần, nhập mã (nếu dùng), chọn Ví/Thẻ.
2. Chuẩn bị tạo đơn với key riêng. POST /orders trả snapshot PENDING và tổng server.
3. Hiển thị tổng server trước thao tác trả tiền cuối cùng. Nếu khác tổng dự tính thì yêu cầu khách xác nhận số tiền mới, không âm thầm trả số tiền khác. Có thể thể hiện bước này trong cùng màn checkout, không thêm màn hình mới.
4. Khách xác nhận trả; POST /payments với payment key riêng.
5. Khi payment SUCCEEDED, đọc GET order và hiển thị trạng thái hiện tại (có thể đã PREPARING/READY/COMPLETED), dọn đúng phần giỏ đã mua. Không coi response replay là trạng thái hiện tại; nếu CANCELLED áp dụng policy Q03, không hiện lời mời nhận món. Khi processing khóa chỉnh sửa giỏ; nếu hỗ trợ chỉnh đồng thời chỉ xóa đúng snapshot đã mua.
6. Khi mock FAILED, giữ nguyên giỏ và orderId. Thử lại với key mới trên order đó; backend giữ lại tồn trước thanh toán.
7. Sửa giỏ đã gắn order: GET current state rồi hủy unpaid trước khi sửa/tạo checkout mới; chưa rõ kết quả thì giữ context, đọc lại/retry. Không sửa snapshot; order cũ giữ trong lịch sử. PENDING bỏ dở giữ tồn tới xử lý/hủy theo Q09, không TTL/job và không tạo đơn chỉ để preview giá. Paid không ép hủy.

Không endpoint quote riêng. Q04/Q10 đã chốt: giá DB, chỉ fixed amount; snapshot giữ khi payment retry. Một mã/đơn, kiểm tra tồn tại/active/thời hạn/minimum DB khi tạo. finalAmount = max(0, subtotal - configuredDiscount); response discountAmount = min(subtotal, configuredDiscount), total = finalAmount. Ví dụ subtotal 8.000đ, mã giảm 10.000đ: discountAmount="8000", total="0". Không percentage/client total hoặc giảm do client gán; minimum không cố định 50.000đ trong logic.

## 9. State transitions và cancel unpaid

**B16 implementation:** `OrderService.transitionOrder(orderId, expectedVersion, targetStatus)` và `assertTransition` đã implement đúng graph cho FR11/12; [contract/evidence](B16_ORDER_WORKFLOW_CONTRACT.md). Service chỉ nhận target PREPARING/READY/COMPLETED/CANCELLED; các cạnh Payment/unpaid giữ write path hiện có và dùng chung graph assertion. Không controller binding hoặc endpoint mới. Return là current detail projection hiện có, không công khai version/owner. ExpectedVersion phải INTEGER không âm (sai400 VALIDATION_ERROR), được kiểm tra nguyên bản sau user lock/reread rồi CAS; không thay bằng version mới hơn. Sai cạnh409 INVALID_ORDER_STATE, stale/CAS/recognized lock timeout409 CONCURRENT_UPDATE, missing404 ORDER_NOT_FOUND, technical/invariant503 SERVICE_UNAVAILABLE. PostgreSQL adapter SQLSTATE nằm trong meta.driverAdapterError.cause.originalCode cũng được nhận diện; lỗi SQL khác không bị coi là conflict.

Baseline Q02 dùng service + tests; extension A01–A06/UI01 bổ sung đúng các operator actions ở §15. Không generic public PATCH status hoặc test HTTP bypass. Q03/DR14/DR15: không customer paid-cancel/no refund; nội bộ hoàn tồn/thu hồi đúng award cùng transaction. Service contract chi tiết bên dưới.

### POST /orders/:id/cancel — API hỗ trợ đã chốt

JWT owner, body rỗng; không target status/actor hoặc Idempotency-Key. Chỉ PENDING/PAYMENT_FAILED → CANCELLED. PENDING hoàn qty; FAILED không hoàn thêm. Status/version và stock/version cùng transaction. 200 trả snapshot/current state như GET detail. Lặp trên CANCELLED trả 200 current state, không side effect. 400 VALIDATION_ERROR cho ID/body sai; 401 UNAUTHORIZED; 404 ORDER_NOT_FOUND cho không tồn tại/không sở hữu; 409 INVALID_ORDER_STATE cho PAID/PREPARING/READY/COMPLETED; 409 CONCURRENT_UPDATE khi CAS conflict; 503 SERVICE_UNAVAILABLE khi lỗi kỹ thuật rollback. Q03: Customer không hủy PAID/PREPARING/READY/COMPLETED; không thêm CONFIRMED vì workflow không có trạng thái này. Không refund/payment reversal. CAS phân xử cancel/payment đồng thời; request thua đọc lại current state, không hoàn tồn hai lần.

### Internal PAID cancellation — service và Admin wrapper

Service nhận orderId/expectedVersion từ luồng nội bộ/test harness đáng tin cậy, không từ customer body/role/header. Chỉ PAID → CANCELLED; PREPARING/READY/COMPLETED bị từ chối theo graph. Command đã CANCELLED trả current state không mutation; assertTransition vẫn chặn self-edge.

Order status/version/updated_at + stock/version theo qty snapshot + award.reversed_at + user balance/updated_at commit cùng một PostgreSQL transaction. Thu hồi đúng award.points gốc, không tính lại policy. Thiếu award/sai owner/balance thiếu/overflow: rollback toàn bộ, lỗi invariant 503 SERVICE_UNAVAILABLE; CAS conflict 409 CONCURRENT_UPDATE, sai cạnh 409 INVALID_ORDER_STATE. Không refund/gateway call hoặc staff public status API. Payment SUCCEEDED/amount và paid_at không đổi. Hoàn tiền external/manual nằm ngoài đồ án.

Sau paid-cancel, GET order/GET history của owner trả status=CANCELLED, earnedPoints=0, paidAt giữ lịch sử, paymentStatus=SUCCEEDED (payment vẫn thành công, không hàm ý refund). Tổng/snapshot không đổi. Ví dụ trường current state:

```json
{
  "status": "CANCELLED",
  "earnedPoints": 0,
  "paidAt": "2026-10-06T10:00:00Z",
  "paymentStatus": "SUCCEEDED"
}
```

Replay POST /payments key cũ sau cancel vẫn trả SUCCEEDED/PAID/awardedPoints lịch sử nhưng không ghi side effects; client GET current order hiển thị CANCELLED/0, không reaward, không thông báo “đã hoàn tiền”. Key mới cho CANCELLED trả 409 INVALID_ORDER_STATE.

## 10. Acceptance tests ở mức contract

- Bảy endpoint PDF có mặt, đúng quyền, validate và định dạng trả về; menu rỗng/chi tiết không có; JWT sai; lịch sử chỉ owner.
- Client sửa total/status/userId bị từ chối; ID topping của sản phẩm khác và qty âm/lẻ bị từ chối.
- Stock=1, hai checkout song song: chỉ một đơn thành công; request còn lại lỗi rõ ràng, DB không âm.
- Hai payment cùng key, cả tuần tự lẫn song song: cùng response/paymentId/orderId; một success và một lần cộng điểm.
- Hai key khác nhau cho cùng order: chỉ một success; lần còn lại không trừ tiền/cộng điểm lần hai.
- FAILED giữ giỏ; key cũ replay FAILED; key mới thử lại qua PENDING, không tạo order mới.
- Request đã commit mất response: cùng key replay, GET order cho trạng thái hiện tại.
- Replay tạo đơn vẫn đúng khi catalog/mã/stock đã đổi; replay payment sau đơn chuyển PREPARING vẫn trả kết quả cũ, còn UI lấy trạng thái hiện tại qua GET order.
- Promotion không hợp lệ không tạo đơn; hợp lệ cho tổng đúng; Loyalty chỉ cấp khi PAID với policy đã chốt.
- Cancel unpaid đúng owner, repeat không hoàn tồn hai lần, cross-owner 404, paid 409; cancel/payment đồng thời chỉ một transition commit.
- Internal cancel order có 12 points: stock hoàn đúng qty, balance trừ đúng 12, award.points vẫn 12/reversed_at có giá trị; repeated/concurrent cancel không hoàn/trừ lần hai.
- Failure tại mỗi write cancellation rollback status/stock/award/balance; hai order cùng user award/cancel nguyên tử không lost update.
- COMPLETED không award mới; total=0 award 0 tại PAID rồi cancel đánh dấu reversed, không âm balance.
- Replay payment sau cancel trả lịch sử, GET current CANCELLED/earnedPoints=0/paymentStatus=SUCCEEDED; không side effects mới.
- Chuyển trạng thái sai/ra khỏi trạng thái kết thúc bị chặn; paid-cancel hoàn qty snapshot/thu hồi đúng award, giữ payment/paid_at, không hoàn tiền; command cancel lặp không effect mới.

## 11. OPEN QUESTIONS / closure

Q01–Q19 đã RESOLVED/ACCEPTED USER hoặc SCOPED; DR14/DR15 đã CLOSED. Không API/role/status/loyalty/stock decision mở. Path/DTO/error contract và expected tests đã đồng bộ; implementation mapping hiện hành ở §15 và các gateway contracts; kết quả nghiệm thu cần đối chiếu tests/môi trường riêng, không suy từ design closure.

## 12. Bootstrap endpoint — hỗ trợ kỹ thuật B03

Recovery đã implement và verify **GET /health**, Public, HTTP 200, response `{"status":"ok"}`. Đây là liveness process NestJS, không database readiness, không business requirement/role mới. Không query DB, không Auth/CRUD/order/payment. Unknown route trả 404 `NOT_FOUND` theo shared error envelope. Environment validation, CORS và JSON body limit 64 KiB đã có; malformed JSON trả 400 `VALIDATION_ERROR`, oversized JSON trả 413 `PAYLOAD_TOO_LARGE`, không lộ parser internals/stack.

Đã chạy 12 test foundation và live GET /health HTTP 200. Mapping NFR04/NFR08 → B03 → HealthController, không entity/database table riêng. Không dùng kết quả health để tuyên bố NFR latency hoặc business API đã đạt; xem README/DEVELOPMENT_PLAN cho trạng thái hiện hành.

## 13. Cart — B08 user decision

All four endpoints use B07 JwtAuthGuard. No query parameters; body whitelist rejects userId/prices/options on PATCH. Identity from req.user.id (JWT subject), cross-owner item and absent item both 404 CART_ITEM_NOT_FOUND.

| Endpoint | Input | Success |
| --- | --- | --- |
| GET /cart | none | 200 Cart response, empty valid without creating row |
| POST /cart/items | productId UUID, size S/M/L, toppingIds UUID array, qty integer | 201 full Cart response; merge quantity |
| PATCH /cart/items/:id | UUID id, {qty} only | 200 full Cart response |
| DELETE /cart/items/:id | UUID id, empty body | 200 full Cart response |

Cart response: {items:[{id,productId,productName,imageUrl,available,size,qty,toppings:[{id,name,price}],unitPrice,lineTotal}],totalQuantity,subtotal,currency:"VND"}. All monetary values strings of integer VND. GET empty: {items:[],totalQuantity:0,subtotal:"0",currency:"VND"}. Current catalog prices recalculated for every response, no price snapshots in Cart. unitPrice=base+size extra+sum toppings, lineTotal=unitPrice*qty, subtotal=sum lines; Decimal, reject monetary overflow before commit.

POST/PATCH require product stock>0 (availability only, qty need not fit stock), valid product size/topping associations. Missing product 404 PRODUCT_NOT_FOUND; unavailable 409 OUT_OF_STOCK; invalid associations 400 INVALID_ITEM_OPTIONS; DTO/bounds/overflow 400 VALIDATION_ERROR. UUID topping IDs lowercased and sorted; duplicate UUID IDs rejected; order/case do not alter configuration. Qty 1..99 including merged quantity; <=50 configurations/cart, <=10 toppings. GET still displays previously added unavailable items; DELETE allowed when unavailable. No inventory writes.

Edit options is UI orchestration: unchanged configuration no-op; changed configuration POST current qty first, then DELETE old. POST failure leaves old; DELETE failure warns that both remain and retries DELETE only. Ambiguous network POST failure fetches current cart and asks user to inspect; no automatic POST retry/idempotency claim. Authentication/cache clears locally at logout; DB persists; reload login then GET. No checkout/order/payment behavior.

## 14. Loyalty balance — B14 approved extension D34

GET /loyalty requires the existing JWT guard. Identity is only req.user.id from the verified JWT subject. No query options/body fields: injected userId/loyaltyPoints/pagination fields return400 VALIDATION_ERROR. No per-user path, history endpoint or write/award API is provided.

200: `{ "loyaltyPoints": 9 }`; a user with no points receives `{ "loyaltyPoints": 0 }`. Response projects only the current PostgreSQL users.loyalty_points integer (0..2147483647); it does not derive a balance from Order totals, current Product prices or login state. The operation performs reads only; awards, balances and timestamps remain unchanged. HTTP header `Cache-Control: private, no-store, max-age=0`, plus Vary: Authorization preserving existing CORS Vary: Origin; frontend fetch cache:no-store. Re-entry/Retry re-fetch rather than incrementing cached points.

Missing/invalid/expired JWT or absent authenticated user returns401 UNAUTHORIZED through the existing envelope. Balance-query faults return sanitized503 SERVICE_UNAVAILABLE; authentication-lookup faults retain the existing sanitized500 INTERNAL_SERVER_ERROR convention. Neither exposes SQL/Prisma/credentials. Missing user between guard and balance read also returns401.

PAID transaction là ranh giới award (MOCK, verified IPN và explicit zero dùng LoyaltyService): Decimal floor(snapshot Order.total/10000), unique award/order including0, guarded atomic balance increment in the Payment transaction. Reads/refresh/replay/COMPLETED do not award. History remains B15 GET /orders/me with existing earnedPoints/sort/empty contract; internal reversal remains B16. No business rule/schema/PDF change. [B14 evidence](B14_LOYALTY_CONTRACT.md).

## 15. Admin/Staff extension — A01–A06/UI01; A07 đã hủy

Các controllers dưới đây đã có trong source. A00 giữ thiết kế gốc; A01–A06 và UI01 ghi contract từng phần được duyệt. A07 Campaign/Admin Promotion Management không còn API/schema hiện hành, nhưng B13 promotion eligibility/checkout được giữ.

| Task | Method + path hiện có | Backend permission / DTO / success |
| --- | --- | --- |
| A01 IMPLEMENTED | POST /auth/register, POST /auth/login (existing paths, response role implemented) | Request vẫn email/password; register always CUSTOMER/reject role; user response DB role, JWT sub/iat/exp unchanged; [A01 evidence](A01_RBAC_AUTH_CONTRACT.md) |
| A02 IMPLEMENTED | GET /operator/orders; GET /operator/orders/:id | STAFF/ADMIN; optional exact status list filter; summary/detail B15 snapshots + version/updatedAt;200/no owner PII/no-store; [A02](A02_OPERATOR_ORDER_MANAGEMENT_CONTRACT.md) |
| A03 IMPLEMENTED | POST /operator/orders/:id/transitions | STAFF/ADMIN; `{expectedVersion,targetStatus:PREPARING\|READY\|COMPLETED}`;200 B16 detail không version, GET operator detail sau action |
| A03 IMPLEMENTED | POST /admin/orders/:id/paid-cancel | ADMIN; `{expectedVersion}`;200 B16 detail/no refund; PAID-only/repeat CANCELLED no-op; Staff403 |
| A04 IMPLEMENTED | GET /admin/products; GET /admin/products/:id; POST /admin/products; PATCH /admin/products/:id; DELETE /admin/products/:id | ADMIN; exact ProductCreate/ProductUpdate/expectedVersion theo A00;200/201/204; stock0 server-owned create, không stock PATCH |
| A05 | GET /admin/products/:id/sizes; POST /admin/products/:id/sizes; PATCH /admin/products/:id/sizes/:size; DELETE /admin/products/:id/sizes/:size | ADMIN; S/M/L + extraPrice + parent expectedVersion, không size entity/custom label;200/201/204 |
| A05 | GET /admin/toppings; GET /admin/toppings/:id; POST /admin/toppings; PATCH /admin/toppings/:id; DELETE /admin/toppings/:id | ADMIN; name/price, own expectedVersion update/delete;200/201/204 |
| A05 | GET /admin/products/:id/toppings; POST /admin/products/:id/toppings; DELETE /admin/products/:id/toppings/:toppingId | ADMIN; association toppingId+parent expectedVersion;200/201/204 |
| A06 | GET /admin/inventory; POST /admin/products/:id/inventory-adjustments | ADMIN; GET200 current stock/version; POST key+`{delta,expectedVersion}`→200 committed `{productId,delta,previousStock,stock,version}` |

STAFF GET `/operator/orders` không filter chỉ PAID/PREPARING/READY; filter chính xác có thể thêm COMPLETED, các trạng thái PENDING/PAYMENT_FAILED/CANCELLED bị 403. Detail STAFF chỉ bốn trạng thái được phép, hidden/missing 404. ADMIN đọc đủ bảy trạng thái bằng cùng operator read APIs; frontend Admin không tạo backend read API trùng.

Backend resolve current DB role mỗi request, không operator impersonation. Auth401; wrong-role403 trước lookup/replay; strict DTO400; authorized missing404; invalid edge409 INVALID_ORDER_STATE; stale/CAS/timeout409 CONCURRENT_UPDATE. Responses private/no-store, money string. GET current projection cấp version cho action tiếp theo; không ghép version mới vào response lịch sử của mutation.

Product create stock0/version0/active server-owned; update không nhận stock. Size/association dùng parent Product.version, Topping PATCH/DELETE dùng Topping.version. DELETE nhận `{expectedVersion}`; PATCH ít nhất một mutable field và không nhận null/string thay boolean. FK/last-valid-size/reference guard409 RESOURCE_IN_USE; duplicate409 RESOURCE_ALREADY_EXISTS. Public catalog ẩn inactive, new Cart/Checkout validate active Product/options từ DB; Cart giữ dòng unavailable để khách điều chỉnh, không tự xóa/reprice snapshot Order cũ.

Inventory adjustment cần Idempotency-Key scope user/ADJUST_INVENTORY/key và hash productId/delta/expectedVersion. Auth trước replay, replay trước current resource/version check; replay exact status/body/header. Lost response giữ key/payload, known rollback conflict cần GET/xác nhận intent mới, không auto delta retry. Product/Topping create không promise idempotency. Invalid resulting stock409 INVALID_STOCK_ADJUSTMENT; technical invariant rollback503 SERVICE_UNAVAILABLE.

Transitions và paid-cancel gọi lại engine B16 với owner serialization/status CAS/stock/award/redemption/debt guards. Customer không có quyền paid-cancel; Admin action không cash refund hay sửa Payment SUCCEEDED. Operator không được ghi tùy ý Order total/Payment/Loyalty, không unpaid cancel thay Customer.

Chi tiết DTO/permissions/error: [RBAC](A01_RBAC_AUTH_CONTRACT.md), [operator reads](A02_OPERATOR_ORDER_MANAGEMENT_CONTRACT.md), [workflow](A03_STAFF_WORKFLOW_CONTRACT.md), [products](A04_ADMIN_PRODUCT_MANAGEMENT_CONTRACT.md), [options](A05_SIZE_TOPPING_MANAGEMENT_CONTRACT.md), [inventory](A06_INVENTORY_MANAGEMENT_CONTRACT.md), [role UI](UI01_ROLE_BASED_INTERFACE_CONTRACT.md). Manual provisioning create-only ở CLI, không public registration/seed/startup operator.

## Gateway Attempt DTO và idempotency

Theo [P00 frozen contract](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md) và
[FIX01 amendment](P01B2A_LOYALTY_ATTRIBUTION_AMENDMENT.md), ba routes backend đã được
triển khai cùng các callback/zero/status routes ghi ở đầu tài liệu. Sandbox development là optional qua Normal launcher; production vẫn bị từ chối.

| Route | Contract đã implement |
| --- | --- |
| POST `/payments/vnpay/attempts` | CUSTOMER JWT/current DB role; required ASCII Idempotency-Key1..128; strict `{orderId:uuid}`, empty query.201 `{attemptId,orderId,provider:"VNPAY_SANDBOX",amount,currency:"VND",state:"AWAITING",paymentUrl,expiresAt}`; replay201 exact + `Idempotency-Replayed:true`. Gate OFF →503 PAYMENT_UNAVAILABLE trước mọi write. |
| GET `/payments/attempts/:attemptId` | CUSTOMER owner; UUID; empty body/query;200 normalized P00 status DTO; unknown/cross-owner404 PAYMENT_ATTEMPT_NOT_FOUND. Không trả URL, request/evidence, merchant/claim/key. |
| GET `/orders/:id/payment-attempts` | CUSTOMER owned Order; UUID; empty body; strict limit1..20/default20 và opaque cursor.200 `{current,items,nextCursor}`; current là latest normalized status hoặc null; items newest createdAt DESC,id DESC. Cursor AES-GCM owner/order-bound; invalid/tampered400. Unknown/cross-owner Order404 ORDER_NOT_FOUND. |

Status fields: `attemptId,orderId,provider,amount,currency,providerState,
applicationState,effectiveState,expiresAt,verifiedAt,appliedAt,paymentId,
orderStatus,canResume,canRetry,canCancel,requiresReview,cashRefundStatus`.
Dates ISO UTC; amount whole VND string. `cashRefundStatus=NOT_PROCESSED_BY_BREWLITE`.
REVIEW với provider SUCCEEDED có `messageCode=PAYMENT_RECEIVED_REVIEW`.
Expiry chỉ làm effective UNKNOWN; không mutation, release hoặc retry. Success phải
APPLIED + bound Payment SUCCEEDED + paid-family; paid cancellation giữ SUCCEEDED.
Các reads dùng repeatable-read READ ONLY snapshot. `current` tránh dùng historical
FAILED làm trạng thái retry đang pending; existing Order/history DTO không đổi.

401/403 auth/role;400 DTO/key;404 ownership;409 existing P00 key/state/pending/review/
stock/points/debt/concurrency codes;422 PAYMENT_AMOUNT_UNSUPPORTED;503
PAYMENT_UNAVAILABLE. Private no-store và Vary Authorization/Origin. Mock route trong
VNPAY mode trả403 PAYMENT_PROVIDER_DISABLED kể cả old key; trong MOCK mode,
old Mock replay giữ nguyên và gateway Order không được thanh toán qua Mock.

Production không được bật VNPAY. Development Sandbox cần normalized private profile/local DB, opt-in và service readiness; test-only synthetic gate chỉ dành fixture/isolation tests, không phải cơ chế vận hành Normal Mode. Admission CLOSED từ chối new positive create/initiation/retry; exact historical replay và callback continuity giữ theo contract. Không client header/body/query bypass hoặc fallback MOCK.
[Implementation/evidence](P01B2A_VNPAY_INITIATION_IMPLEMENTATION.md).


## P01-B2B implemented provider callback — 2026-10-17

GET /payments/vnpay/ipn: public provider HMAC-SHA512, no JWT/session/body. Strict raw
PAY query parse8KiB/30 fields, duplicate/encoding/UTF-8/whitelist validation. Accepted
requests return HTTP200 {RspCode,Message}, no generic error envelope, no-store.
00 after durable APPLIED/REVIEW;02 only processed equivalent notification;01 known
provider authentication/unknown ref;04 wrong amount;97 invalid signature/merchant;
99 malformed/body/technical/gate-OFF or unresolved UNKNOWN. T1 receipt commits
separately; unprocessed duplicate resumes T2. Customer initiation/status contracts
stay unchanged; REVIEW message also recognizes retained verified success evidence.
Runtime remains MOCK; synthetic isolated test gate only. No Return/QueryDr/zero
route added. [T1/T2, effects and tests](P01B2B_VNPAY_IPN_SETTLEMENT_IMPLEMENTATION.md).


## P01-D4C cancellation UX ? additive read-only DTO (2026-10-21)

Authenticated owned GET `/payments/attempts/:attemptId` and status objects in GET
`/orders/:id/payment-attempts` optionally include
`failureReason: "CUSTOMER_CANCELLED"`. Omit otherwise; no raw provider query/code or
merchant/secret fields are exposed. Emit only for the latest Attempt, effective
FAILED, existing terminalBound failed Payment/Attempt application, no REVIEW, no
pending Attempt or unprocessed verified receipt, Order PAYMENT_FAILED or CANCELLED
with no paidAt, persisted Attempt24/02 and VERIFIED processed receipt24/02. This
means gateway payment cancellation, not automatic Order cancellation. Status GETs
remain read-only; permissions, errors, canResume/canRetry/canCancel and routes stay
unchanged. Return remains the same verified-context303 to the result page and never
settles/cancels. Frontend resolves authenticated status before Home navigation.
Implementation and focused checks (báo cáo/evidence lịch sử đã dọn; hướng dẫn hiện hành tại [Normal Mode](NORMAL_SANDBOX_MODE.md)).


## Normal local launcher control boundary (2026-10-21)

No customer API path/DTO/status/error, callback protocol, capability or financial
contract changes in this task. Backend main emits safe validated readiness via
parent-only IPC and accepts graceful shutdown from that parent; there is no HTTP
provider/admission toggle. The launcher's random-port127.0.0.1 controller requires a
random local token and is not reachable through the callback allowlist. CLI status
is read-only; mutation commands are launcher operations, not application APIs.
Default MOCK remains merchant-free. [Operation](NORMAL_SANDBOX_MODE.md).
