# P00 — VNPAY Sandbox Payment Contract

Ngày audit/freeze: 2026-10-15, Asia/Saigon. **P00 CONTRACT FROZEN — USER APPROVED D01/A–D08/A.**
P00 chỉ audit/design/documentation; chưa implementation, chưa migration, chưa cấu
hình merchant/tunnel hoặc test VNPAY. [Vận hành hiện hành](NORMAL_SANDBOX_MODE.md) ghi bằng chứng
baseline và giới hạn. Người dùng đã chọn rõ D01/A–D08/A trong yêu cầu CONTRACT
FREEZE. Thiết kế dưới đây là APPROVED DESIGN, chưa là runtime implementation.
Provider prerequisites vẫn NOT VERIFIED; freeze không cấp phép bắt đầu P01,
đăng ký merchant, cấu hình credentials hoặc cài/chạy tunnel.

## 1. Quyền hạn, baseline và mapping

| Phân loại | Nội dung |
| --- | --- |
| APPROVED | P00 frozen design D01/A–D08/A; giữ B13/L01, lịch sử Mock và A07 rollback; không production/refund API/P01 implementation |
| EXISTING | HEAD `872a81076e81d53fb642b17b79bc90fc8954e04b`; B04–B16/A00–A06/UI01 ready về technical scope; L00 frozen/L01 ready |
| EXISTING | PostgreSQL18.6 `brewlite_dev/public`, 10 migrations; A07 và compensation đều giữ trong history; không Campaign |
| APPROVED DESIGN | EXT-PAY-SBX01 initiation/redirect;02 verified IPN/settlement;03 pending/retry/reconciliation;04 explicit zero completion;05 cancellation/refund disclosure |
| NOT VERIFIED | D08 merchant credentials/profile, callback, codes/minimum/query/signing fixtures và actual Sandbox transaction; required trước enable |
| NOT AUTHORIZED | P01/UI02/B17 implementation; hosting/deploy; merchant registration, credentials setup, tunnel install/run |

PDF [BrewLite VER1.0](BrewLite-CongNghePhanMem.pdf) vẫn yêu cầu mock ở baseline;
gateway Sandbox là extension người dùng yêu cầu thiết kế, không sửa PDF thành yêu
cầu VNPAY bắt buộc. FR06–09/11–16, BR03–14, NFR02/04–07/10 được tái sử dụng;
NFR01 <500ms không tự được miễn hoặc đổi thành timeout5s. Không Campaign/banner,
voucher/wallet, queue, scheduler, microservice hoặc hạ tầng production.

Các hợp đồng [B10](B10_ORDER_CONTRACT.md), [B11](B11_PAYMENT_CONTRACT.md),
[B13](B13_PROMOTION_CONTRACT.md), [B16](B16_ORDER_WORKFLOW_CONTRACT.md),
[L00](L00_LOYALTY_REDEMPTION_CONTRACT.md), [L01](L01_LOYALTY_REDEMPTION_IMPLEMENTATION.md)
giữ nguyên như historical baseline và current runtime. P00 đã được phê duyệt chỉ
supersede **thiết kế gateway mode tương lai** ở các điều khoản Mock/zero/cancellation
§14–17; không sửa văn bản frozen B11/L00/L01 hoặc coi runtime đã chuyển gateway.

## 2. Audit lifecycle đang chạy — EXISTING

| Thành phần | Hành vi thực tế |
| --- | --- |
| Payment | UUID/orderId/userId; unique idempotencyRequestId; key; Decimal(12,0) amount; method WALLET/CARD; status SUCCEEDED/FAILED; failureCode; createdAt |
| SQL protections | UNIQUE(user_id,idempotency_key); partial UNIQUE(order_id) WHERE SUCCEEDED; CHECK amount>=0; success failureCode=NULL/failure nonempty; RESTRICT FK |
| Order graph | PENDING→PAID→PREPARING→READY→COMPLETED; PENDING→PAYMENT_FAILED→PENDING; PENDING/PAYMENT_FAILED/PAID→CANCELLED; terminal không đi ra |
| Create | Owner lock; max1 unpaid/user; full Cart equality; current B13 pricing; immutable snapshots; stock OCC giảm ngay; RESERVE điểm/cycle1; Cart giữ và khóa writes |
| Mock pay | CUSTOMER POST /payments + key; owner→Order locks; server config SUCCESS/FAILURE quyết định ngay trong một DB transaction |
| Success | Payment SUCCEEDED, Order PAID/version/paidAt, SETTLE/EARN, unique Award floor(total/10000), debt-aware balance và purchased Cart clear atomic; không trừ tồn lần hai |
| Failure | Payment FAILED/MOCK_DECLINED, PAYMENT_FAILED, stock restore, RELEASE điểm/debt-first atomic; Cart/snapshot giữ; không Award |
| Retry failed | Key mới; reacquire đúng snapshot qty/điểm, cycle+1 khi r>0; PAYMENT_FAILED→PENDING; không kiểm lại Promotion/giá/options hiện tại |
| Lost HTTP response | Key cũ/hash cũ replay result lịch sử; client GET Order hiện tại, không lấy replay làm current state |
| Unpaid cancel | Customer owner PENDING/PAYMENT_FAILED; PENDING release/restore một lần; failed không release lần hai; CANCELLED repeat no-op |
| Paid cancel | ADMIN A03→B16; chỉ PAID và expectedVersion; restock, REFUND điểm đã dùng, REVERSE award gốc một lần; giữ Payment SUCCEEDED/paidAt/amount; không hoàn tiền |
| Debt exception | Sau owner lock, positive-redemption payment có debt bị chặn trước mock/Payment/stock; unpaid cancel là recovery hiện tại của L01 |
| Concurrency | User owner FOR UPDATE trước FK-bearing claim; existing Order FOR UPDATE; Products ID ASC CAS; 50ms maxWait/400ms transaction, lock200ms/statement300ms |

`LoyaltyService` đọc balance/history; effects ghi trong shared
`loyalty-accounting.ts` do Order/Payment gọi cùng transaction, không có một Loyalty
transaction độc lập. `REFUNDED`/journal `REFUND` là **điểm**, không phải tiền VNPAY.
Current Checkout/parser chỉ hiểu synchronous WALLET/CARD result. JWT memory-only
bị mất khi full-page gateway redirect; sessionStorage chỉ giữ retry identifiers.
Thay URL của Mock không giải quyết được các ràng buộc này.

## 3. Nguồn VNPAY và profile giao thức

Đã đọc trực tiếp ngày2026-10-15, không dùng unofficial SDK/blog làm authority:

- [S1 — PAY, initiation/IPN/Return](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html).
- [S2 — QueryDr và Refund](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html).
- [S3 — Version/hash transition](https://sandbox.vnpayment.vn/apis/docs/chuyen-doi-thuat-toan/changeTypeHash.html).
- [S4 — Mã lỗi PAY](https://sandbox.vnpayment.vn/apis/docs/bang-ma-loi/).
- [S5 — Technical specification2.1.0](https://sandbox.vnpayment.vn/apis/files/VNPAY%20Payment%20Gateway_Techspec%202.1.0-VN.pdf), §2.3/2.5; nguồn bổ trợ, không thay web profile hiện hành.

Web profile công bố2.1.0. Chọn HMAC-SHA512 theo S3; không MD5/SHA256 fallback,
không gửi `vnp_SecureHashType` outbound2.1.0. PAY URL là
`https://sandbox.vnpayment.vn/paymentv2/vpcpay.html`; querydr POST JSON tới
`https://sandbox.vnpayment.vn/merchant_webapi/api/transaction`. Chỉ VND.
Ngày provider `yyyyMMddHHmmss` theo GMT+7; DB lưu timestamptz UTC.

S1 phân biệt IPN GET/SSL để cập nhật và Return để browser trở lại. IPN thành công
chỉ khi cả `vnp_ResponseCode=00` **và** `vnp_TransactionStatus=00`; một PHP sample
dùng OR khác sample .NET dùng AND. BrewLite chọn AND; không copy sample rút gọn.
S2 có typo kiểu dữ liệu ResponseCode/OrderInfo và thiếu toán tử nối trong công thức
response hash; hiểu là các trường theo đúng thứ tự §12, không copy lỗi cú pháp.
S5 cũ còn nêu USD/iframe trong khi web PAY nêu VND; P00 pin VND/top-level redirect.
Chưa chứng minh merchant account được enable2.1.0, amount minimum, query throttling,
mọi cặp mã IPN thực tế hoặc tunnel registration. Những điểm đó là gate P01/Sandbox.

## 4. Kiến trúc đã duyệt — chưa triển khai

Giữ một Nest application, thêm provider adapter trong miền Payments; reuse cùng
Order/stock/accounting policies. Tách initiation, verification receipt và apply
financial outcome thành các entrypoint rõ ràng. Không gọi VNPAY từ transaction DB.

```mermaid
sequenceDiagram
    participant C as Customer / Next
    participant B as Nest Payments
    participant D as PostgreSQL
    participant V as VNPAY Sandbox
    C->>B: POST /orders (existing key)
    B->>D: PENDING + stock/points reserve + snapshots
    C->>B: POST /payments/vnpay/attempts (payment key)
    B->>D: Durable attempt/ref + completed initiation claim
    B-->>C: 201 signed paymentUrl + expiresAt
    C->>V: Top-level redirect
    V->>B: HTTPS GET IPN (browser independent)
    B->>B: Parse / HMAC / merchant / ref / amount verification
    B->>D: T1 durable verified receipt
    B->>D: T2 apply outcome + Order/Payment/accounting atomically
    B-->>V: RspCode after commit or retryable99
    V-->>C: Browser Return (order can vary)
    C->>B: GET Return resolver (read only)
    B-->>C: 303 fixed clean result page
    C->>B: Login if needed; owned authoritative status GET
```

Browser Return và IPN có thể đảo thứ tự/thiếu một phía. Return không settlement,
không release, không cấp điểm, kể cả chữ ký đúng. Querydr xác thực phía backend
dùng cùng verification/apply path; không gọi lại synchronous `mock.result()`.

## 5. Initiation và dữ liệu ký

1. CUSTOMER/JWT/current DB role + strict body `{orderId:uuid}` + key như baseline
ASCII printable1..128. Không amount/outcome/provider/merchant/returnUrl từ client.
2. Owned Order lookup trước replay; cross-owner404. Hash mới có discriminator
`VNPAY_INITIATE_V1` và orderId, dùng **PAY_ORDER namespace đang có**. Giữ nguyên hash
WALLET/CARD cũ và CREATE_ORDER. Cùng key khác action/order/method→409, không thêm
enum operation để tránh xung đột UNIQUE(user,key) của Payment.
3. Owner→Order locks; reread state/account/attempts. Chặn nếu pending attempt,
unprocessed verified receipt hoặc REVIEW. PAID trở đi reject; CANCELLED reject.
4. PENDING không reserve lần hai. PAYMENT_FAILED chỉ retry sau failure verified và
applied; reacquire stock/points theo L01, increment cycle, transition→PENDING cùng
transaction tạo attempt. Thiếu stock/points/debt rollback cả retry, không phát URL.
5. Amount lấy immutable Order.total, `minor = Decimal(total) ×100`, serialize integer
string, tuyệt đối không Number/parseFloat/floor phép chia callback. VND>0 và minor
<=999999999999 theo numeric12 của PAY; total lớn nhất qua gateway theo profile này
là9999999999 VND. Order DECIMAL(12,0) lớn hơn giới hạn gateway:422
PAYMENT_AMOUNT_UNSUPPORTED, không sửa snapshot. Minimum merchant là gate xác nhận,
không bịa mức5000 hoặc gửi0. Zero theo D01/A đã duyệt tại §14.
6. Ref là UUID random bỏ dấu gạch thành32 hex, unique toàn lịch sử; không dùng
orderCode/timestamp ngắn. Mỗi **attempt mới** một ref; HTTP replay giữ ref cũ.
7. Lưu immutable amount/currency/merchant/date/ref/expiry/return URL snapshot; ký
local; complete claim với201 và exact response/payment URL rồi commit **trước** khi
trả URL. Không viết Payment terminal, không cấp điểm trong initiation.
8. Replay trả cùng URL/ref/expiry đã lưu, dù đã hết hạn; header Idempotency-Replayed.
Không lặng lẽ phát ref mới. Client đọc current status/canResume/canRetry trước dùng
URL cũ; không tái redirect khi verified terminal/REVIEW/expired.

Outbound params profile (server-owned; giới hạn wire theo S1/S3/S5):

| Nhóm | Giá trị BrewLite đề xuất |
| --- | --- |
| `vnp_Version`, `vnp_Command`, `vnp_CurrCode`, `vnp_Locale` | `2.1.0`, `pay`, `VND`, `vn` |
| `vnp_TmnCode`, `vnp_TxnRef`, `vnp_Amount` | Config8 alnum; ref32 hex; positive minor digits<=12 |
| `vnp_CreateDate`, `vnp_ExpireDate` | Provider dates14; proposed validity15 minutes, immutable; không phải release TTL |
| `vnp_OrderInfo`, `vnp_OrderType` | ASCII alnum/spaces `Thanh toan BrewLite <ref>` <=255; category `other` phải được merchant chấp nhận |
| `vnp_ReturnUrl`, `vnp_IpAddr` | Allowlisted fixed HTTPS URL<=255; validated requester IP<=45, không lấy Host/header tùy ý |
| `vnp_BankCode` | Omit để khách chọn tại gateway; không ánh xạ WALLET/CARD cũ thành bank code |
| `vnp_SecureHash` | HMAC-SHA512 hex128; thêm sau canonicalization |

Không gửi billing/invoice/customer email, card/OTP hoặc optional fields không cần.
TmnCode xuất hiện trong signed gateway URL theo giao thức; HashSecret tuyệt đối không.

## 6. Canonicalization, verification và callback hardening

Profile signing theo Node example S3: sort tên ASCII tăng dần; encode UTF-8 từng
key/value đúng **một lần** bằng encodeURIComponent rồi `%20`→`+`; nối `key=value`
bằng `&`; HMAC trên bytes UTF-8; HashSecret là configured string UTF-8 literal,
không hex/base64-decode và không prepend secret vào message; digest hex. Không serialize bằng một encoder khác
ở bước phát URL. Pin exact fixtures cho space/plus/%/Unicode/URL punctuation;
không dùng mặc định URLSearchParams để thay thế vì escaping có thể khác.
Outbound OrderInfo giới hạn alnum/spaces để tránh khác biệt punctuation giữa demo
PHP/Node. URL/values snapshot không nhận chuỗi đã percent-encode từ client.

Inbound lấy **raw query multimap**, decode một lần, reject malformed percent/UTF-8,
duplicate decoded keys, array/object/nested keys, control characters, excessive
query>8KiB hoặc>30 keys. Scalar whitelist2.1.0 gồm required fields S1 và optional
BankTranNo/CardType/PayDate; unexpected field không bị âm thầm bỏ khỏi signed set:
fail closed99/semantic validation, review fixture trước enable. Không áp dụng DTO
JWT/JSON error envelope chung cho IPN. Không log raw query.

Loại `vnp_SecureHash` và optional `vnp_SecureHashType` khỏi signing data. Không cho
HashType thương lượng/downgrade thuật toán; nếu có phải tương thích pinned HMAC
profile. Chữ ký phải regex128 hex trước decode thành64 bytes; length check rồi
timingSafeEqual với digest local. Không so sánh bằng `===` hoặc chỉ prefix hash.

Thứ tự xử lý: syntax/bounds→HMAC→configured merchant equality→known ref lookup→
attempt amount/currency/merchant/config context→provider semantics→durable receipt→
financial state validation/commit. Merchant/ref/amount không lấy từ cookie/JWT của
browser. IPN không cần JWT hoặc CSRF cookie; HMAC là authentication provider.
Callback không chứa vnp_CurrCode theo required PAY fields thì không tự thêm điều
kiện bắt buộc; expected stored currency phải VND, nếu currency được gửi thì phải VND.

Amount callback phải numeric integer và **bằng exactly expected minor string/value**,
không chia100 rồi round. PayDate optional phải calendar-valid GMT+7 nếu có; lưu UTC
riêng với receivedAt/confirmedAt; không lấy PayDate làm thời gian commit hay lease.
TransactionNo giữ string để không mất leading digits; success yêu cầu nonzero
numeric<=15. Mã0 ở failure không trở thành shared unique transaction number.
Không lưu bank account/card/OTP/HashSecret, không log signed URLs/Authorization.

Replay prevention dựa durable ref/merchant/amount binding + receipts + local outcome
locks/uniques. Không reject late authentic success chỉ vì local expiresAt đã qua.
Chữ ký không chứng minh payload mới; historical valid replay phải no-op.

## 7. Provider result và IPN acknowledgement

Đây là mapping **APPROVED DESIGN, provider fixtures NOT VERIFIED**,
không đồng nhất API request result với money:

| Nguồn/cặp mã đã verified | Interpretation / hành động |
| --- | --- |
| IPN ResponseCode00 + TransactionStatus00 | Provider SUCCEEDED; thử settlement nếu trạng thái local cho phép |
| IPN non00, non07 + TransactionStatus02 và response thuộc decline allowlist | Provider FAILED; apply failure/release; allowlist đề xuất09/10/11/12/13/24/51/65/75/79; phải pin bằng fixture merchant |
| Querydr ResponseCode00 + TransactionType01 + TransactionStatus00 | Query request thành công và giao dịch thanh toán success; cùng settlement path |
| Querydr ResponseCode00 + type01 + status02 | Query request thành công, transaction failed; apply verified failure |
| TransactionStatus01; querydr91/no record; timeout/network failure | UNKNOWN, giữ reservations; không release/retry/cancel |
| Response07 hoặc status07; status04; refund states05/06/09; type02/03; unknown/contradictory codes | REVIEW; không suy ra failure/refunded hoặc thay snapshots |
| IPN00/status02 hoặc non00/status00 | Không dùng OR; giữ evidence, REVIEW/querydr; không tự PAID/release |

S4 phân biệt response11 (hết thời gian),24 (khách hủy ở gateway),07 (có thể đã trừ
tiền/nghi ngờ). Chỉ **verified callback** và terminal mapping mới kích hoạt failed
effects; browser thấy24, local hết15 phút hay query91 không đủ chứng minh failure.
Nếu status02/response không thuộc allowlist thì giữ UNKNOWN/REVIEW, không đoán.

IPN trả HTTP200 JSON `{RspCode,Message}` không chứa internal error/Order/customer:

| RspCode | Khi nào trả |
| --- | --- |
| `00` | Receipt và kết quả APPLIED hoặc deliberate REVIEW đã durable commit; không có nghĩa mọi Order đều PAID |
| `02` | Notification tương đương đã được apply/review durable; không chạy lại effects |
| `01` | Signature/merchant hợp lệ nhưng ref không tồn tại |
| `04` | Ref hợp lệ nhưng amount sai; không business writes |
| `97` | Signature sai; merchant sai cũng reject97 theo policy không tiết lộ merchant |
| `99` | Malformed/unsupported input, DB/network-to-DB/lock failure hoặc chưa commit được receipt/effects |

S1 nêu00/02 kết thúc retry;01/04/97/99/timeout kích hoạt retry, tối đa10 calls cách5
phút. Không dựa số retry đó làm terminality/release timer. Không trả00 trước commit.
Duplicate có receipt nhưng T2 chưa apply phải thử T2 lại, không trả02 sớm. Cùng ref
nhưng kết quả khác là event mới cần conflict review, không phải duplicate02.
Nếu chưa persist review được thì99. Invalid callbacks không tạo financial/evidence
rows; ghi security count/log sanitized có bounds, không nhận một public logging DB sink.

## 8. Database proposal — chỉ trong tài liệu, chưa áp dụng

Chọn **hai bảng mới** thay vì mở rộng PaymentStatus thành pending rồi phá toàn bộ
baseline parsers/accounting. Payment vẫn terminal local outcome. Attempt lưu trạng
thái gateway kể cả khi local không thể apply; Verification giữ durable input/query
request và dedup. Không cần bảng refund/queue/scheduler.

Prisma structural proposal bên dưới không phải file schema đang chạy. Inverse
relations chỉ được thêm vào Order/IdempotencyRequest khi P01 được giao riêng.

```prisma
enum PaymentProvider {
  MOCK
  VNPAY_SANDBOX
  INTERNAL_ZERO
}
enum GatewayState {
  AWAITING
  UNKNOWN
  SUCCEEDED
  FAILED
}
enum GatewayApplicationState {
  PENDING
  APPLIED
  REVIEW
}
enum VerificationSource {
  IPN
  QUERYDR
}
enum VerificationState {
  REQUESTED
  VERIFIED
  UNRESOLVED
}

model PaymentAttempt {
  id                   String                  @id @default(uuid()) @db.Uuid
  orderId              String                  @map("order_id") @db.Uuid
  idempotencyRequestId  String                  @unique @map("idempotency_request_id") @db.Uuid
  provider             PaymentProvider         @default(VNPAY_SANDBOX)
  merchantCode         String                  @map("merchant_code") @db.VarChar(8)
  txnRef               String                  @unique @map("txn_ref") @db.VarChar(32)
  amount               Decimal                 @db.Decimal(12, 0)
  currency             String                  @default("VND") @db.Char(3)
  state                GatewayState            @default(AWAITING)
  applicationState     GatewayApplicationState  @default(PENDING) @map("application_state")
  transactionNo        String?                 @map("transaction_no") @db.VarChar(15)
  responseCode         String?                 @map("response_code") @db.Char(2)
  transactionStatus    String?                 @map("transaction_status") @db.Char(2)
  createDate           String                  @map("create_date") @db.Char(14)
  expiresAt            DateTime                @map("expires_at") @db.Timestamptz(6)
  providerPaidAt       DateTime?               @map("provider_paid_at") @db.Timestamptz(6)
  verifiedAt           DateTime?               @map("verified_at") @db.Timestamptz(6)
  appliedAt            DateTime?               @map("applied_at") @db.Timestamptz(6)
  reviewReason         String?                 @map("review_reason") @db.VarChar(64)
  requestParameters    Json                    @map("request_parameters") @db.JsonB
  createdAt            DateTime                @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime                @default(now()) @map("updated_at") @db.Timestamptz(6)
  order                Order                   @relation(fields: [orderId], references: [id], onDelete: Restrict)
  idempotencyRequest   IdempotencyRequest       @relation(fields: [idempotencyRequestId], references: [id], onDelete: Restrict)
  payment              Payment?
  verifications        PaymentVerification[]
  @@unique([merchantCode, transactionNo])
  @@index([orderId, createdAt(sort: Desc), id(sort: Desc)])
  @@map("payment_attempts")
}

model PaymentVerification {
  id                   String             @id @default(uuid()) @db.Uuid
  attemptId            String             @map("attempt_id") @db.Uuid
  source               VerificationSource
  state                VerificationState
  requestId            String?            @unique @map("request_id") @db.VarChar(32)
  queryCreateDate      String?            @map("query_create_date") @db.Char(14)
  payloadHash          String?            @map("payload_hash") @db.Char(64)
  payload              Json?              @db.JsonB
  errorCode            String?            @map("error_code") @db.VarChar(64)
  receivedAt           DateTime           @default(now()) @map("received_at") @db.Timestamptz(6)
  verifiedAt           DateTime?          @map("verified_at") @db.Timestamptz(6)
  processedAt          DateTime?          @map("processed_at") @db.Timestamptz(6)
  attempt              PaymentAttempt     @relation(fields: [attemptId], references: [id], onDelete: Restrict)
  @@unique([attemptId, source, payloadHash])
  @@index([attemptId, receivedAt, id])
  @@map("payment_verifications")
}
```

`Order.paymentAttempts PaymentAttempt[]` và
`IdempotencyRequest.paymentAttempt PaymentAttempt?` là inverse additions.
PaymentMethod **APPROVED additive enum design** thêm `VNPAY`, `ZERO_TOTAL`; giữ WALLET/CARD.
Không sửa OrderStatus, PaymentStatus, IdempotencyState/Operation, Loyalty enums.
Payment bổ sung fragment (mọi field cũ giữ):

```prisma
// Inside existing Payment, proposed additions only:
provider         PaymentProvider @default(MOCK)
gatewayAttemptId String?         @unique @map("gateway_attempt_id") @db.Uuid
confirmedAt      DateTime?       @map("confirmed_at") @db.Timestamptz(6)
gatewayAttempt   PaymentAttempt? @relation(fields: [gatewayAttemptId], references: [id], onDelete: Restrict)
```

CHECK/index/FK proposal cho PostgreSQL:

| Object | Exact invariant / compatibility |
| --- | --- |
| `payments_provider_check` | MOCK⇒method WALLET/CARD + gateway_attempt_id NULL; VNPAY_SANDBOX⇒method VNPAY + amount>0 + nonnull attempt/confirmed_at; INTERNAL_ZERO⇒method ZERO_TOTAL + amount=0 + no attempt + SUCCEEDED + confirmed_at nonnull |
| Existing Payment constraints | Giữ nguyên success/order partial UQ, user/key UQ, claim UQ, amount/failure code checks và RESTRICT FKs; FAILED VNPAY dùng stable internal failureCode `VNPAY_DECLINED` |
| `payment_attempts_provider_check` | Chỉ VNPAY_SANDBOX; currency VND; amount integer1..9999999999; txn_ref lowercase hex32; merchant alnum8 |
| `payment_attempts_dates_check` | expires_at>created_at; create_date14 digits/date semantics verified tại app; requestParameters object chứa đúng outbound snapshot, không secret/hash |
| `payment_attempts_application_check` | APPLIED⇒state SUCCEEDED/FAILED và applied_at nonnull; PENDING⇒applied_at null; REVIEW⇒review_reason nonempty (applied_at có thể còn từ một terminal outcome trước) |
| SQL partial unique `payment_attempts_one_pending_per_order_idx` | UNIQUE(order_id) WHERE application_state='PENDING'; chặn hai attempt chưa xử lý đồng thời. REVIEW của attempt cũ được coexist với một attempt mới đã phát trước conflict; service chặn initiation khi có bất kỳ REVIEW |
| Provider txn uniqueness | UNIQUE(merchant_code,transaction_no), NULL cho chưa biết/failure0; nonnull numeric1..15, nonzero. Một transaction number không được gán sang ref khác |
| Evidence checks | IPN⇒state VERIFIED, requestId/queryCreateDate NULL; QUERYDR⇒requestId hex32/date14 có trước outbound; VERIFIED⇒payload object/hash64/verifiedAt nonnull; REQUESTED/UNRESOLVED⇒không có verified payload/hash; processedAt chỉ khi VERIFIED |
| Evidence mutation | IPN payload/hash/source immutable; QUERYDR REQUESTED→VERIFIED hoặc UNRESOLVED một lần; verified payload không overwrite; processedAt chỉ đánh dấu consume. Không delete evidence/payment bằng nghiệp vụ thông thường |
| Cross-table invariants | Attempt.order.owner=claim.user, operation PAY_ORDER, claim.orderId=attempt.orderId; terminal Payment order/user/amount/key/claim=attempt+Order; enforce dưới owner/Order locks, không giả vờ CHECK đơn bảng enforce join |

`requestParameters` lưu allowlisted unsigned outbound params để audit; signed URL
chỉ trong private initiation claim response để exact replay. `payload` chỉ normalized
allowlisted provider evidence (merchant/ref/minor/code/status/txnNo/type/date/bank/
responseId/promotion fields nếu có), không raw request/header/BankTranNo/card/account.
Hash là SHA256 của canonical verified message, không HashSecret; querydr dùng signed
pipe-string của chính response. Hai nguồn khác nhau vẫn settle một lần qua Attempt.
Các field `responseCode/transactionStatus` trên Attempt là kết quả verified đã chọn,
không phải last callback thắng; bằng chứng mâu thuẫn được giữ từng event và REVIEW.

Backfill: mọi Payment cũ providerMOCK, gatewayAttemptId/confirmedAt NULL; không bịa
provider confirmation time, không tạo fake Attempt cho lịch sử. Old columns/keys/
Order snapshots/journal/Awards nguyên vẹn. Không rewrite old claim response JSON.
Legacy parsers chỉ dùng cho Mock; parser VNPAY/zero mới phải hiểu discriminated DTO.

## 9. Transaction, crash recovery và exactly-once effects

Tất cả paths có mutation (initiation/IPN/query apply/cancel/zero) theo thứ tự:
**owner User FOR UPDATE → Order FOR UPDATE → relevant Attempts ID ASC → receipt/claim
rows → Product IDs ASC CAS → financial inserts/updates/Cart**. Read-only ownership/ref
lookup trước lock không quyết định state. Sau lock reread và verify references.
Admin actor không thay owner lock. Không codepath khóa Attempt trước owner rồi
đảo thứ tự; không network call trong transaction. Giữ short transaction budget hiện
có cho mỗi T; thay budget cần measurement và quyết định riêng, không tự nâng để
bao outbound querydr. Không blind retry financial transaction sau lỗi.

**T1 verification receipt:** HMAC/syntax đã kiểm ngoài DB; lấy locks trên owner/Order/
Attempt, kiểm immutable merchant/ref/amount; insert unique verified receipt. Commit
receipt trước T2 (querydr cập nhật chính REQUESTED row thành VERIFIED thay vì tạo
request thứ hai). Không đổi Order/Payment/balance/stock tại T1. DB outage99 và provider
retry. Crash sau T1 trước T2 có receipt chưa processed; IPN retry hoặc explicit ADMIN
reconciliation tiêu thụ lại, không ACK02 bỏ quên. Không cần queue.

**T2 application:** cùng lock order, đọc mọi chưa processed receipt liên quan và
current financial state. Chỉ một compatible verified terminal outcome được apply.
Success normal đòi Order PENDING, reservations cycle hiện tại hợp lệ, no prior success,
account reconciliation/debt gate pass, purchased Cart đủ snapshot. Trong **một commit**:
Payment SUCCEEDED/VNPAY + original initiation claim FK/key; Order PAID/version/
paidAt=local settlement time; SETTLE/EARN/unique Award; balances; Cart clear;
Attempt APPLIED/provider success; receipt processed. Không repricing/reacquire stock.
providerPaidAt lưu riêng, không backdate journal/các state transition theo PayDate.

Verified failure normal khi PENDING: Payment FAILED/VNPAY_DECLINED + PAYMENT_FAILED;
restore stock/RELEASE điểm debt-first đúng cycle; Attempt APPLIED/FAILED, receipt
processed atomic. **Không dùng reservationGate để chặn release verified failure khi
debt phát sinh sau initiation**: baseline Mock gate chạy trước khi có money event;
gateway decline không có debit, release phải dùng đúng effect RELEASE debt-aware.
Đây là orchestration delta đã duyệt trong D07/A, không đổi công thức hay journal.
Không auto charge/attempt mới khi lỗi stock/account/CAS; rollback T2 còn T1 bền vững.

Transient lock/DB/T2 failure:99, receipt còn pending, financial changes rollback toàn
bộ. Semantic không thể apply (Order cancelled/already paid bởi attempt khác, debt
chặn positive settlement, Cart thiếu, provider contradictions/foreign transactionNo):
giữ receipt, set REVIEW/reason trong transaction riêng cùng locks; không tạo Payment
SUCCEEDED giả, không award/reacquire/refund/rewrite snapshot. Sau review durable ACK00,
GET phải nêu money confirmed và local application pending nếu có success evidence.
Nếu review write thất bại99. REVIEW không coi là technical retry cho khách trả lần nữa.

Unique Payment success/order, unique Award/order, journal effect keys, unique
Payment.gatewayAttemptId và locked attempt/receipt cùng bảo vệ exactly-once **local**
effects. Không tuyên bố distributed exactly-once charge; gateway success có thể đến
sau failure/cancellation, phải lưu ngoại lệ tiền thay vì discard.

## 10. Lifecycle, expiry, retry và cancellation races

| Tình huống | Local contract APPROVED DESIGN |
| --- | --- |
| URL mới phát / khách đang authorize | Attempt AWAITING/PENDING; Order PENDING; giữ stock/points/Cart lock; không Payment terminal |
| Khách đóng tab / mất Return hoặc IPN | Không suy ra FAILED; GET hiển thị pending/unknown; không chạy mock thay thế |
| Quá expiresAt | URL không resume; effective UNKNOWN trong GET, không mutation trong GET; giữ reservations và chặn retry/cancel; admin querydr |
| Return trước IPN | Clean result/login→GET pending; poll bounded, không PAID từ query |
| IPN trước Return / không Return | Backend settle bình thường; khách xem owned Order/history sau login |
| Valid late success, vẫn cùng PENDING/reservations | Settle dù URL đã hết hạn; không expiry timestamp filter loại bỏ tiền |
| Confirmed failure applied | Payment/Order failed; released một lần; có thể hủy hoặc retry key/ref mới sau customer confirmation |
| Same-key initiation HTTP retry | Exact201 response/ref cũ; không cycle/stock/points write mới |
| Different key khi pending/unknown/REVIEW |409 PAYMENT_PENDING hoặc PAYMENT_REQUIRES_REVIEW; không thêm ref |
| Failed retry | Reacquire snapshot/cycle trong initiation transaction, không phải khi callback về |
| Duplicate IPN / concurrent querydr/IPN | Unique receipt + locks; apply một lần, duplicate02 sau durable resolution |
| Failure sau applied success | Không downgrade/restore; lưu conflict REVIEW; tiền/PAID/journal cũ giữ |
| Success sau applied failure | Không overwrite failed Payment; lưu success evidence/REVIEW; nếu retry khác đang pending thì giữ cả hai evidence và chặn customer charge/cancel |
| Một transactionNo cho hai refs | Retain second verified evidence; REVIEW, không link/settle hai Order |
| Cancel thắng trước initiation | CANCELLED, initiation409; URL chưa từng trả cho customer |
| Initiation thắng trước unpaid cancel | Cancel409 PAYMENT_PENDING dù Order PENDING; cả backend/UI cần guard mới |
| IPN success thắng cancel | PAID; Customer cancel409; chỉ ADMIN paid-cancel theo §15 |
| Valid money success cho Order đã CANCELLED | Không mở terminal Order, không restock ngược/re-award; receipt+REVIEW và cảnh báo tiền cần đối soát |

Mọi Customer unpaid-cancel route phải dùng cùng attempt/receipt guard, không chỉ
disable nút ở Checkout. Gate tìm **mọi** pending receipt/REVIEW cho Order, không chỉ
latest attempt. D31 max1 unpaid không đổi; một payment unknown có thể giữ stock/
points và khóa Cart lâu. Đó là tradeoff D03 cần chọn rõ; không có job tự giải phóng.

## 11. Return URL và session recovery

Đề xuất Return URL cố định trên callback ingress:
`https://<temporary-host>/payments/vnpay/return` → Nest GET read-only verifier/resolver.
Valid signature/merchant/ref/amount chỉ resolve attempt ID; không gọi apply/T1/T2,
không tin status browser để cập nhật.303 về allowlisted
`http://localhost:3000/payments/vnpay/result?attemptId=<uuid>`; invalid/unknown redirect
về cùng generic result page không chứa ref/customer data. Không open redirect,
không reflect provider Message thành HTML, `Cache-Control:no-store`,
`Referrer-Policy:no-referrer`; scrub provider query trước khi frontend render.

Browser full-page redirect làm mất JWT memory. Result page public chỉ có generic
message và login link; detail/amount/Order phải qua CUSTOMER auth/ownership GET.
ReturnTo chỉ local allowlisted result route+UUID, không external URL. Không đưa JWT
vào query/cookie/sessionStorage để né login. Trước redirect chỉ cache ownerId/orderId/
attemptId/idempotencyKey trong sessionStorage, không token/secret/full signed URL.
Sau account switch khác owner→404, không dùng cache làm quyền truy cập.
Mất toàn bộ cache vẫn mở Order history/GET owned Order và attempts để khôi phục.

## 12. Querydr reconciliation — APPROVED DESIGN, chưa triển khai

Không background scheduler hoặc auto refund. Một ADMIN-authenticated local-only
POST reconcile query gateway **ngoài DB transaction**, timeout5s có abort, TLS verify,
fixed allowlisted destination. Rate cap đề xuất một query/attempt/30s, kiểm recent
REQUESTED evidence dưới owner/Order lock trước khi phát; không dùng callback request
để ép outbound URL. Provider-specific minimum delay/rate chưa có bằng chứng áp dụng
cho merchant, phải xác nhận trước enable.5s là failure bound, không promise đạt NFR01.

Trước outbound, lưu QUERYDR REQUESTED với random hex32 requestId unique toàn bộ
history, queryCreateDate14 và attempt; crash sau write có thể còn REQUESTED, không
có financial result. Network/invalid signature→UNRESOLVED sanitized reason, giữ
resources. Retry inquiry dùng requestId mới; query không phải payment charge. Customer
Refresh chỉ đọc local, không tạo querydr request. Không đòi HTTP Idempotency-Key cho
inquiry; provider requestId+rate gate+terminal settlement dedup chống lặp effects.

S2 querydr **không dùng PAY sorted-query signing**. Chuỗi request HMAC-SHA512 theo
thứ tự, pipe separator, raw string UTF-8 không URL-encode:

```text
vnp_RequestId|vnp_Version|vnp_Command|vnp_TmnCode|vnp_TxnRef|vnp_TransactionDate|vnp_CreateDate|vnp_IpAddr|vnp_OrderInfo
```

TransactionDate là **stored original PAY CreateDate**, không dùng now/PayDate;
queryCreateDate là thời gian request mới. Omit optional request TransactionNo vì
profile tối thiểu ref+original date đã đủ. Response checksum theo S2:

```text
vnp_ResponseId|vnp_Command|vnp_ResponseCode|vnp_Message|vnp_TmnCode|vnp_TxnRef|vnp_Amount|vnp_BankCode|vnp_PayDate|vnp_TransactionNo|vnp_TransactionType|vnp_TransactionStatus|vnp_OrderInfo|vnp_PromotionCode|vnp_PromotionAmount
```

Giữ empty segments cho optional absent fields, không sort/trim/Unicode normalize
hoặc drop separator. Validate response HMAC128, merchant/ref/exact minor/type01,
responseId/field types và request context trước chuyển REQUESTED→VERIFIED receipt.
ResponseCode00 của querydr chỉ nói inquiry xử lý thành công: xem status theo §7.
91/not found chưa chứng minh giao dịch không charge. S2 không echo RequestId trong
mọi response: bind bằng owned request record/outbound call + merchant/ref/date,
không bịa response field bắt buộc.

Verified success sau local expiry được settlement nếu đủ điều kiện. Chạy lại query
hoặc IPN sau PAID không cấp điểm lần hai. Return callback không được dùng thay
querydr evidence dù signature valid. Không nhận arbitrary transaction/ref từ Admin
body để query giao dịch không có local Attempt. S5 §2.3 nêu tình huống merchant
không cung cấp hàng phải xử lý cung cấp hàng/hoàn tiền; P00 giữ REVIEW và defer
quyết định vận hành, không coi đó là bằng chứng refund đã làm.

## 13. API contracts — toàn bộ additive proposal, chưa tồn tại

| Method/path | Auth / DTO / response |
| --- | --- |
| POST `/payments/vnpay/attempts` | CUSTOMER owner, key; strict `{orderId}`;201 `{attemptId,orderId,provider:"VNPAY_SANDBOX",amount:"85000",currency:"VND",state:"AWAITING",paymentUrl,expiresAt}`; replay201+header |
| GET `/payments/attempts/:attemptId` | CUSTOMER owner, UUID/empty body/query;200 status DTO bên dưới;404 unknown/cross-owner |
| GET `/orders/:id/payment-attempts` | CUSTOMER owner; strict limit1..20/default20, cursor opaque owner/order-bound nếu cần trang sau; newest createdAt DESC,id DESC; no-store; không trả payload/signature/URL/key |
| GET `/payments/vnpay/ipn` | Provider HMAC public; raw query contract §6; HTTP200 JSON ack §7; không JWT |
| GET `/payments/vnpay/return` | Public read-only resolver §11;303 fixed clean result; không settlement |
| POST `/orders/:id/confirm-zero` | CUSTOMER owner+key, strict empty body/query; only total0;200 terminal internal completion; D01/A USER APPROVED, chưa implemented |
| POST `/admin/payments/vnpay/attempts/:id/reconcile` | ADMIN DB role, local-only protected API, strict empty body/query;200 normalized status sau inquiry/apply hoặc202 unknown;429 gate/503 upstream/technical; không refund/force-paid |
| GET `/admin/payments/vnpay/reviews` | ADMIN, local-only; bounded limit1..50/default20 + opaque cursor; normalized evidence summary/reason; chỉ hỗ trợ nhìn và query, không chỉnh journal |

Status DTO: `attemptId,orderId,provider,amount,currency,providerState,
applicationState,effectiveState,expiresAt,verifiedAt,appliedAt,paymentId|null,
orderStatus,canResume,canRetry,canCancel,requiresReview,cashRefundStatus`.
cashRefundStatus là derived `NOT_PROCESSED_BY_BREWLITE` cho VNPAY và
`NOT_APPLICABLE` cho internal-zero; không phải bằng chứng provider chưa/đã refund.
effectiveState: AWAITING/UNKNOWN/SUCCEEDED/FAILED/REVIEW; thành công UI chỉ khi
applicationStateAPPLIED + local PaymentSUCCEEDED + Order paid-family. Legitimate
ADMIN cancellation sau PAID vẫn giữ tiền SUCCEEDED khi Order CANCELLED/paidAt
nonnull: UI phải tách “Đơn đã hủy” và “Thanh toán đã ghi nhận, chưa tự hoàn tiền”,
không biến paid cancellation thành payment failure hoặc REVIEW mới. Nếu gateway
success nhưng applyREVIEW, trả message code PAYMENT_RECEIVED_REVIEW và không
label payment failed. Backend capabilities từ current consistent DB snapshot; client
không tự suy ra canRetry từ Order PAYMENT_FAILED hoặc đồng hồ.

Existing GET `/orders/:id` đề xuất thêm `paymentState` summary tương thích additive,
giữ `paymentStatus` là **latest terminal local record**, có thể vẫn FAILED trong
khi retry attempt đang chờ. Updated Checkout/confirmation dùng summary/capabilities,
không lấy historical FAILED làm tín hiệu trả lần nữa. B15 Order history giữ existing
DTO hoặc thêm summary cùng ý nghĩa, không thay PaymentStatus enum bằng UNKNOWN.

New app APIs giữ envelope hiện hành,401 JWT/403 role/404 ownership;
400 VALIDATION_ERROR/MISSING_IDEMPOTENCY_KEY;409 KEY_REUSED/IN_PROGRESS,
ORDER_ALREADY_PAID/INVALID_ORDER_STATE/CONCURRENT_UPDATE/OUT_OF_STOCK,
LOYALTY_INSUFFICIENT_POINTS/LOYALTY_REVERSAL_OUTSTANDING và PAYMENT_PENDING/
PAYMENT_REQUIRES_REVIEW;422 PAYMENT_AMOUNT_UNSUPPORTED;503 PAYMENT_UNAVAILABLE;
429 RECONCILIATION_RATE_LIMITED. Key error thực tế dùng tên baseline
`IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`, không literal KEY_REUSED.
IPN ACK là provider-specific ngoại lệ không bọc `{error:...}`. Authenticated
financial responses `private,no-store,max-age=0`, Vary Authorization/Origin;
IPN/Return no-store, không cache/CDN/login redirect vào IPN.

## 14. Zero-total — D01/A USER APPROVED

**D01/A — APPROVED:** giữ Order total0 PENDING, vẫn RESERVE điểm/tồn như L01.
Nút riêng **“Xác nhận đơn 0 VND”** + giải thích không chuyển tới VNPAY. CUSTOMER
explicit click/key gọi confirm-zero; PAY_ORDER hash `{action:"ZERO_COMPLETE_V1",orderId}`
phân biệt initiation/Mock và không nhận amount/outcome. Owner→Order locks/account proof/debt gate, total
exact0/no pending external attempt; một atomic Payment providerINTERNAL_ZERO/
methodZERO_TOTAL/SUCCEEDED/amount0 + PAID + SETTLE + Award0/EARN0 theo L01 + Cart
clear + exact claim replay; SETTLE chỉ khi redeemedPoints>0. Không gọi mock hoặc gửi
VNPAY URL0. Không tự động PAID
sau create/preview/return. Client không nhận success boolean để quyết định tài chính.
Internal failure/invariant rollback toàn bộ; không giả lập một provider decline mới.
Hủy trước confirm theo unpaid baseline; paid cancellation hoàn điểm/tồn như L01,
không có tiền gateway cần hoàn. L01 zero Mock SUCCESS/FAILURE tests giữ ở explicit
Mock mode; new zero integration cần tests riêng về technical failure và replay.

Không clamp điểm/Promotion để tạo số tiền>0. D01/B (block completion0) không được
chọn; không phải một fallback của contract frozen.

## 15. PAID cancellation, cash refund và received-but-unapplied — D02/D04

**D02/A — APPROVED:** tiếp tục ADMIN PAID cancellation của B16/A03 sau khi hiển
thị và xác nhận rõ **“Hủy đơn hoàn tồn và điều chỉnh điểm; không tự hoàn tiền VNPAY.
Khoản thanh toán vẫn được ghi nhận. Hoàn tiền phải được xử lý/đối soát riêng.”**
Giữ Payment SUCCEEDED và paidAt; refund status hiển thị `NOT_PROCESSED_BY_BREWLITE`,
không một trường persisted `REFUNDED` bằng tiền. Order.cancelled/redemptionREFUNDED
không map sang gateway refunded. Customer confirmation/history và Admin dialog
đều phân biệt hoàn điểm, reversed award và tiền. Defer automatic refund API hoàn
toàn; không tạo endpoint refund ở P01.

D02/B (disable riêng VNPAY paid-cancel) không được chọn; không tự disable cạnh
PAID→CANCELLED. Refund API không thuộc P01.

**D04/A — APPROVED:** verified success không apply an toàn → receipt và REVIEW,
không mở lại Order CANCELLED, không fake PaymentFAILED, không charge lại, không
auto refund, không tự sửa điểm/tồn. Admin local review/query có evidence ID và lý
do, Customer thấy khoản tiền cần đối soát. Một successful attempt thứ hai là possible
extra payment, không được unique-success constraint che mất bằng rollback receipt.

Đặc biệt: hủy PAID A có thể tạo debt trong khi B đã reserve điểm và đang ở VNPAY.
L01 không cho B tự dùng future award để hết debt. Nếu VNPAY B success lúc này,
receipt phải được giữ và REVIEW; không gọi lại Mock gate để nói chưa nhận tiền.
Không tự cho phép SETTLE vượt debt, không tự cancel B để che money mismatch.
Chưa thiết kế force-resolution write/refund ledger: resolution ngoài các safe
transitions phải xin approval riêng; P01 cần công bố rõ giới hạn manual Sandbox
review này. Không ghi refunded khi chưa có provider refund confirmation; kể cả
sau thao tác thủ công ở merchant portal, không suy ra điều đó chỉ từ Admin click.

## 16. Local HTTPS ingress và configuration — D06

Approved local topology: Next `http://localhost:3000`, Nest
`http://127.0.0.1:3001`; một **callback ingress riêng bind127.0.0.1:3102** chỉ proxy
GET exact `/payments/vnpay/ipn` và `/payments/vnpay/return` tới Nest. Temporary HTTPS
tunnel chỉ tới3102; mọi path/method khác404/405. Không tunnel thẳng toàn bộ3001,
không wildcard path, không public Admin/auth/orders/health/DB/Prisma Studio.
Ingress có thể là tiny local adapter/proxy trong P01; không framework/service mới
trong P00. Nest main.ts dùng ConfigService PORT; environment.ts default3001,
local PORT hiện có cũng3001. Source main.ts hiện chưa pin bind address; loopback
binding/ingress restriction là yêu cầu P01 cần kiểm chứng, không claim đã áp dụng.
Tool tunnel cụ thể và mọi install/run cần yêu cầu riêng; không đổi firewall.
Không dùng Render, Vercel, Railway hoặc hosting/deployment nào; toàn bộ app và DB
tiếp tục local, chỉ provider Sandbox là external và tunnel chuyển tiếp callbacks.

IPN URL `https://<temporary-host>/payments/vnpay/ipn` phải đăng ký/cập nhật với
merchant VNPAY; **không phải một `vnp_IpnUrl` param tự bịa trong PAY URL**.
Return URL cùng public host/path cố định;303 về localhost chỉ phù hợp browser trên
cùng máy. Browser trên điện thoại/máy khác không dùng localhost này; nếu muốn demo
remote phải phê duyệt frontend HTTPS exposure/origin/return policy khác.

Public ingress TLS được tunnel terminate, upstream HTTP loopback; verify certificate
không bị tắt. Không assume IP allowlist nguồn VNPAY khi chưa có danh sách chính thức;
HMAC vẫn bắt buộc. CORS không ngăn server-to-server forged callbacks. Không blanket
trust proxy/X-Forwarded-For; Customer initiation qua local API lấy socket client IP,
chỉ trust configured known proxy hop nếu kiến trúc thay đổi. Callback rate/body/query
bounds không được yêu cầu login/challenge làm provider không gọi được.

Các **tên biến mới chỉ đề xuất**, chưa sửa env/config/schema/package:

```dotenv
PAYMENT_PROVIDER_MODE=VNPAY_SANDBOX
VNPAY_ENV=SANDBOX
VNPAY_VERSION=2.1.0
VNPAY_TMN_CODE=<configure_locally>
VNPAY_HASH_SECRET=<configure_locally_never_commit>
VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNPAY_QUERY_URL=https://sandbox.vnpayment.vn/merchant_webapi/api/transaction
VNPAY_RETURN_URL=https://<temporary-host>/payments/vnpay/return
VNPAY_IPN_URL=https://<temporary-host>/payments/vnpay/ipn
VNPAY_RESULT_URL=http://localhost:3000/payments/vnpay/result
VNPAY_ATTEMPT_TTL_SECONDS=900
ALLOW_MOCK_PAYMENTS=false
```

P01 mới thêm placeholder vào .env.example và cấu hình thực vào root ignored .env;
không yêu cầu gửi TmnCode/HashSecret trong chat, không thu thập/cấu hình credentials
VNPAY tại P00. Read-only DB audit chỉ dùng local DB configuration đang có.
Fail startup khi missing secret/TmnCode, invalid URL/host/path/HTTP public callback,
production mode/production host hoặc algorithm khác. Test mode explicit MOCK có
thể thiếu VNPAY credentials; default không được silently fallback Mock khi config
VNPAY sai. Secret/TmnCode không đổi khi còn unresolved attempts trừ khi có key
rotation/drain plan được phê duyệt; không log values hoặc mang HashSecret ra frontend.

Reachability gate P01: từ mạng ngoài request exact IPN unsigned phải tới handler
và nhận sanitized97; other paths404/methods405; sau đó actual Sandbox signed IPN
được nhận và ACK sau commit. Unsigned97 chỉ chứng minh routing, không chứng minh
merchant registration/signature/actual payment E2E. Tunnel hostname thay đổi cần
cập nhật cả registration/config; không sửa destination của attempt đang chờ hoặc
giả vờ IPN sẽ tìm được hostname mới. Không publish DB.

## 17. Customer UI và Mock compatibility — D05

Giữ Product/Cart/Order/Loyalty UI, chỉ đổi payment section/result/detail cần thiết.
Positive total: nhãn nút chính **“Thanh toán”**, đúng nguyên văn, không gắn tên
provider/Sandbox/thử nghiệm hoặc số tiền vào nhãn. Tổng tiền server hiển thị riêng.
Có thể có dòng phụ “Bạn sẽ được chuyển đến cổng thanh toán thử nghiệm.” và giải
thích đăng nhập lại khi quay về; không nhập card/OTP trong BrewLite. Disable double
click, lưu stable key trước request; chỉ location.assign tới HTTPS exact sandbox
payment host/path; không tin paymentUrl arbitrary/injected. Không iframe/pop-up.

Result: preparing redirect/loading; awaiting verified confirmation; success khi
local applied; confirmed failed với retry/cancel theo capabilities; UNKNOWN giải
thích “Chưa xác định kết quả, không thanh toán lại”; REVIEW “Giao dịch cần đối soát”.
Đề xuất poll owned GET mỗi3s tối đa60s khi visible; stop terminal/review/logout,
pause hidden; sau đó nút tải lại, không đổi UNKNOWN thành FAILED. Không gọi gateway
query trực tiếp từ browser. Payment detail/history chỉ server amounts/outcomes,
không raw callback/merchant evidence; bounded attempts và safe Vietnamese text.

Mock baseline có **server** SUCCESS/FAILURE config, không có Customer outcome buttons;
Checkout hiện tại còn chọn Ví/Thẻ giả lập; đó là current baseline, không phải UI
gateway được duyệt. D05/A chỉ giữ Mock cho isolated test mode phục vụ kiểm thử đồ án.
Customer trong VNPAY mode không phải chọn WALLET/CARD trước redirect; không gửi
vnp_BankCode mặc định, không tự liệt kê phương thức merchant chưa chứng minh hỗ trợ.
Khả năng lựa chọn thực tế do Merchant Sandbox/gateway quyết định, NOT VERIFIED.
VNPAY mode phải backend-gate POST /payments Mock **kể cả gọi
trực tiếp**:403 PAYMENT_PROVIDER_DISABLED, không chỉ ẩn UI; zero dùng route riêng sau
D01. Không cho Customer tự đổi provider qua body/query/header; không expose outcome
controls khi VNPAY mode active. Legacy Payment/claim bodies và historical GET được
giữ; old Mock HTTP replay được regression trong explicit MOCK mode, không mở một
Mock bypass trong VNPAY mode (POST /payments vẫn disabled kể cả old key).
không rewrite lịch sử để gán chúng thành VNPAY. UI/auth account-switch bảo vệ mọi
late response; memory JWT policy không bị thay bởi gateway integration.

## 18. Migration safety và future verification gates

P00 không tạo SQL/migration/schema file. Proposal P01 cần **hai append-only
migrations sau10 hiện tại**: (a) thêm PaymentMethod labels và commit; (b) thêm enums/
tables/Payment columns/index/CHECK. PostgreSQL không dùng enum value vừa ALTER ADD
trong cùng transaction của constraint; không gộp thiếu commit boundary. Không đổi
SQL của10 migration đã apply, không xóa A07 ledger, không reset/destructive db push.

Isolated restore first: old-column fingerprints của16 business tables, full existing
ledger rows/checksums, all old FK/index/CHECK; migrate candidate chain12; defaults
MOCK/null, empty attempts/evidence; legacy0/failed/success/paid-cancel/replay still
work. Enum addition không được gọi là rollback-safe bằng cách xóa enum values.
Future schema backout giữ additive objects/history, không drop attempts/receipt khi
đã có provider data. Deployment pause compatible writers; backend/callback code và
client generated version cùng schema; initial gateway feature off; enable sau tests.

Rollback application không được chuyển active positive payment về Mock hoặc tắt
IPN/reconciliation khi còn unresolved refs. Drain/keep compatible callback service
và evidence trước mọi backout. Business/public data không seed/restore để che mismatch.
No application completion claim chỉ vì Prisma proposal tồn tại.

Mọi AC dưới đây là **NOT RUN** ở P00. U=unit/HTTP; DB=real isolated PostgreSQL;
SIM=signed callback simulation; SB=actual merchant Sandbox; MAN=human manual;
SEC=security/ingress. Existing rollback tests PASS chỉ là historical baseline.

| AC | Level | Trigger / acceptance cần chứng minh |
| --- | --- | --- |
| P01 | U | Golden canonical vectors: sorting, space/plus/%/URL/Unicode/punctuation; no double encoding; HMAC512 đúng |
| P02 | U | Exact85000→8500000;0/negative/fractional/overflow/minor>12digits bị reject; no Number rounding |
| P03 | U/SEC | Client amount/owner/outcome/returnUrl/merchant/bank injection rejected; fixed sandbox allowlist/no open redirect |
| P04 | DB | Initiation commit precedes URL; create attempt/claim only, no terminal Payment/Award; lost response same URL/ref/key |
| P05 | DB/SIM | Verified00/00 success writes PAID/Payment/SETTLE/EARN/Cart exactly once, no second stock decrement |
| P06 | DB/SIM | Allowlisted terminal decline releases stock/points exactly once, no Award, Cart retained |
| P07 | U/SIM | Wrong/short/odd/nonhex signature, changed signed field, SHA downgrade, wrong merchant/ref/amount rejected; no business writes |
| P08 | U/SIM | Duplicate decoded key, arrays, malformed encoding, nested/unknown fields, oversized query rejected before unsafe parse |
| P09 | DB/SIM | Duplicate identical IPN→02 only after durable apply/review; T1-only duplicate resumes T2 |
| P10 | DB/SIM | Same/different payload concurrent IPNs and query/IPN race: one Payment/Award/cycle/effect, contradictions retained |
| P11 | DB/SIM | Crash before T1, after T1, before T2 commit/after commit before ACK: recover receipts and exact financial effects |
| P12 | U/DB | Fault at Order/Payment/Products/Cart/Award/User/journal/claim/attempt/receipt apply rolls back T2, receipt remains |
| P13 | SIM/SB | Return before IPN: pending, no points; IPN before Return: already applied; Return never mutation |
| P14 | SB/MAN | Browser close/no Return; IPN still settles; fresh login/history recovers authoritative result |
| P15 | DB/SIM | Local15min expiry/no IPN/query91/query timeout preserve reservations and prohibit cancel/new ref |
| P16 | DB/SIM | Late00/00 after expiry with intact reservation settles once; no date-based discard |
| P17 | DB/SIM | Success after failed/retry or cancelled: REVIEW receipt, no second successful Payment/no terminal Order reopen |
| P18 | DB/SIM | Failure after success, mixed codes, status01/04/07/refund types never downgrade or assume refund |
| P19 | DB | Same key/different action/order409; key namespaces compatible CREATE_ORDER/PAY_ORDER; historical Mock claims unchanged |
| P20 | DB | Different-key initiation while pending/review409; partial UQ; later REVIEW coexists safely with already-issued newer attempt |
| P21 | DB | Confirmed failed retry reacquires exact original stock/points/cycle; insufficient/debt/CAS preserves failed state/no URL |
| P22 | DB | Product/Promotion/option config change after Order never reprices VNPAY amount or retry snapshots |
| P23 | DB/SB |100000−10000−50×100=85000, minor8500000; success earn8, journal conservation and Cart clear |
| P24 | DB | Reversal creates debt while gateway pending: success REVIEW, failure debt-aware RELEASE; no forbidden self-financing |
| P25 | U/DB | Zero explicit confirm, no outbound gateway call; technical fault rollback; duplicate exactly one zero Payment/Award0 |
| P26 | DB | Customer cancel versus initiation/IPN/query commits valid winner; pending money guard server-side |
| P27 | DB/U | ADMIN paid-cancel option chosen; stock/points refund/reversal; Payment stays SUCCEEDED; UI never says money refunded |
| P28 | U/DB | Querydr request/response pipe vectors including absent optional segments; original date/requestId binding; bad HMAC no apply |
| P29 | DB/SIM | Query-request crash/network timeout leaves durable UNRESOLVED/REQUESTED; new inquiry ID, no automatic failure/charge |
| P30 | DB | Same provider transactionNo reused across refs cannot settle two Orders; second evidence preserved REVIEW |
| P31 | DB | Payment/Attempt/claim owner/order/amount links invariant; all FK/CHECK/UQ reject invalid combinations |
| P32 | DB | All10 old migration checksums/rows/16 old-column fingerprints and historical Mock0/success/failure/retry/replay preserved |
| P33 | U/DB | CUSTOMER owner only; guest401, other owner404, STAFF/ADMIN403 on customer APIs; Admin reconciliation role checked from DB |
| P34 | U/DB | VNPAY mode denies direct Mock POST even valid Customer JWT; explicit isolated MOCK regression unchanged |
| P35 | U/browser | Full redirect loses memory JWT; login returnTo safe, no token persistence/query, account switch cannot expose old result |
| P36 | U/browser | Pending/UNKNOWN/REVIEW distinct, poll stops safely; refresh never querydr; no misleading retry/cancel/refund UI |
| P37 | SEC/MAN | Public HTTPS exact IPN/Return only; Admin/auth/Order/DB paths inaccessible through tunnel; methods bounded |
| P38 | SB/MAN | Real registered merchant/IPN reaches backend; signed ACK after commit; actual bank test success/failure/Return/amount matches |
| P39 | SB/MAN | Actual querydr verified response for known attempt and delayed IPN; merchant minimum/rate/status pairs captured without secrets |
| P40 | browser | Primary label exactly Thanh toán, no pre-gateway Mock selector/default bankCode; Customer handoff/result/history/loyalty + Admin/STAFF retained;390/768/1366, keyboard/loading/errors |
| P41 | U/SEC | Startup rejects production endpoints/missing secret; logs/browser/Git contain no credentials/full signed URLs/OTP |
| P42 | DB/build | Full B04–B16/A01–A06/UI01/L01 lint/build/unit/HTTP/DB/browser regression; no A07 routes/banner; NFR measured, not inferred |

SIM không thay thế SB. Headless automated provider/card challenge có thể không được
Sandbox hỗ trợ; nếu vậy mark actual-browser cases MAN/UNAVAILABLE với lý do, không
chuyển simulation PASS thành actual Sandbox PASS. Merchant credentials, registered
HTTPS callbacks, selected ingress tool và bank test capability hiện **NOT VERIFIED**.

## 19. Frozen decisions — D01/A–D08/A USER APPROVED

| ID | Status | Quyết định đã chọn / giới hạn |
| --- | --- | --- |
| D01/A Zero | USER APPROVED | Explicit confirm-zero/internal0 tại §14; không automatic PAID hoặc VNPAY0 |
| D02/A Paid cancel/refund | USER APPROVED | Giữ ADMIN paid-cancel + no-cash-refund disclosure; không refund API trong P01 |
| D03/A Unknown | USER APPROVED | Hold reservations; chặn unsafe retry/cancel; verified provider outcome/querydr trước release |
| D04/A Received/unapplied | USER APPROVED | Durable receipt + REVIEW; không force-paid/refund/reprice/journal repair |
| D05/A Mock | USER APPROVED | Chỉ isolated test mode; backend deny Mock Customer bypass trong VNPAY mode |
| D06/A HTTPS/local | USER APPROVED | localhost frontend3000/backend3001, callback-only ingress3102/tunnel; không deploy; chưa có lệnh install/run tunnel |
| D07/A Technical contract | USER APPROVED | PaymentAttempt/PaymentVerification, additive Payment/method fields, two-step migration design, API/security/locks/receipt/ACK; chưa thực hiện |
| D08/A Provider profile | USER APPROVED; prerequisites NOT VERIFIED | Sandbox2.1.0/HMAC-SHA512; merchant credentials/callback/codes/actual transaction phải verify trước official enable |

### Sandbox prerequisites — NOT VERIFIED

| Prerequisite | Current evidence / gate |
| --- | --- |
| Merchant credentials/profile | NOT VERIFIED; chưa đăng ký/cấu hình/kiểm merchant; không yêu cầu secret trong chat |
| Public HTTPS ingress/tool/registration | NOT VERIFIED; chưa cài/chạy tunnel hoặc đăng ký callback; chỉ duyệt topology |
| Callback TLS/reachability/route isolation | NOT VERIFIED; unsigned routing probe không thay signed actual IPN |
| Merchant methods/minimum/category/limits | NOT VERIFIED; không preset bankCode hoặc hứa WALLET/CARD/QR nào merchant chưa hỗ trợ |
| Provider code pairs/canonical hash fixtures/querydr response | NOT VERIFIED; mapping bảo thủ §7, unknown/contradiction giữ UNKNOWN/REVIEW |
| Actual Sandbox transaction + signed IPN + clean Return | NOT VERIFIED; required trước enable; simulation không thay actual transaction |
| P01 implementation/migration/regression/42 AC groups | NOT RUN; cần assignment riêng, không suy PASS từ freeze |

Không còn business decision P00 mở: D01–D08 đều đã chọn A. Những prerequisites
NOT VERIFIED là implementation/operational gates, không phải thiếu approval design.
Nút chính Customer đúng “Thanh toán”; zero action riêng “Xác nhận đơn 0 VND”.
P00 chỉ đóng băng tài liệu. Current runtime vẫn B11/L01 Mock, không có schema/DB/
application/credential/tunnel changes. Future schema/API snippets là contract được
phê duyệt chưa áp dụng, không được chạy SQL chỉ vì contract đã frozen.

**P00 CONTRACT FROZEN — READY FOR P01 PREPARATION.**
P01 implementation và official gateway enable chưa được phép; đợi yêu cầu tiếp
theo. Không tự bắt đầu P01/UI02/B17, không deploy hoặc push GitHub.
