# P01-B2A — VNPAY initiation and status implementation

2026-10-17. Baseline `e13f732568d0c5c8a4207dd4fd08a1fe96ff185d`. **P01-B2A COMPLETE — READY FOR P01-B2B**.
Gateway development/production vẫn OFF. Chỉ local commit sau mandatory checks;
không push/deploy, không IPN/QueryDr/Checkout hoặc actual Sandbox smoke test.

## Blocker đã giải quyết và phạm vi

B2A-01 được giải quyết bằng [FIX01 amendment](P01B2A_LOYALTY_ATTRIBUTION_AMENDMENT.md)
và [development apply](P01B2A_LOYALTY_ATTRIBUTION_AMENDMENT.md),13 migrations đã apply.
Không sửa P00 frozen/L00/L01, schema hoặc migrations. Hồ sơ blocker gốc được giữ
nguyên văn ở cuối tài liệu; các trạng thái BLOCKED/NOT IMPLEMENTED trong hồ sơ đó
là lịch sử trước FIX01/resume, không phải kết quả hiện tại.

## Routes và response

- POST /payments/vnpay/attempts: CUSTOMER JWT/DB role/owner, key, strict {orderId};201 P00 response, signed URL chỉ tại initiation hoặc exact replay.
- GET /payments/attempts/:attemptId: owner-only404 unknown/cross-owner; normalized P00 status/capabilities, không merchant/key/URL/evidence.
- GET /orders/:id/payment-attempts: owned Order; limit1..20/default20, deterministic createdAt DESC/id DESC, encrypted owner/order-bound cursor; {current,items,nextCursor}.

Reads dùng repeatable-read READ ONLY. Private no-store/Vary Authorization/Origin.
Current summary độc lập historical page; không dùng historical FAILED để suy ra
pending retry đã failed. Existing Order/history DTO giữ nguyên. P00 success chỉ
APPLIED + matching Payment + paid-family; legitimate paid cancellation vẫn success,
cash refund status không được diễn giải là đã hoàn tiền. REVIEW success có message
PAYMENT_RECEIVED_REVIEW. Expiry chỉ effective UNKNOWN, không write/release/retry.

## Transaction và idempotency

Lock User owner → Order → all Attempts → Claim/related rows → sorted Products.
Reread sau lock; claim hash SHA256 của {action:VNPAY_INITIATE_V1,orderId} trong
PAY_ORDER namespace cũ. Owned lookup trước replay; cùng key khác action/order409.
Completed response201 lưu exact body/URL/ref/expiry; replay không gia hạn URL.
Concurrent same-key trở về committed replay hoặc transient409 yêu cầu dùng lại key;
không tự lặp transaction tài chính. Different-key chỉ một pending Attempt.

PROCESSING claim phải order_id NULL theo existing CHECK. Tạo Attempt, complete/bind
claim rồi ghi FIX01 journal trong cùng transaction; không trạng thái trung gian nào
được trả trước commit. Local signing không network. Giữ nguyên50ms maxWait/400ms
transaction,200ms lock/300ms statement; không nới timeout để chạy tests.

PENDING giữ nguyên Order/snapshots/stock/points/Cart. Không Payment/Award terminal.
Amount từ Decimal Order.total → whole-VND string → BigInt×100,85000→8500000; zero
hoặc >9999999999 VND422, không reprice/round. UUID32 lowercase txnRef unique.
Unsigned immutable request snapshot trong Attempt; HMAC512 dùng P01-A canonical
helper, Sandbox host allowlist, fixed HTTPS Return, date UTC+7/15-minute validity,
không default BankCode. Socket IP validated, không tin X-Forwarded-For tùy ý.

## Gateway retry và compatibility

PAYMENT_FAILED chỉ đủ điều kiện nếu latest bound gateway failure VERIFIED/APPLIED,
matching terminal Payment/owner/order/claim/amount và processed receipt; không còn
PENDING/UNKNOWN/REVIEW hoặc VERIFIED receipt chưa processed. Mock failure không
được cross-provider retry. Tái kiểm tra account/debt/points, snapshot stock/version.
Atomic new Attempt/claim + Order PENDING/CAS + stock OCC + cycle+1 khi redeemed>0 +
RESERVE.paymentAttemptId=Attempt. Không fake Payment; terminal attribution sẽ giữ
cùng Attempt khi phase settlement được giao. Thiếu stock/points/debt/technical
fault rollback toàn bộ; historical journal không rewrite.

Customer cancellation dùng cùng all-attempt/receipt guard, kể cả zero points;
retry/cancel cùng owner serialization. UNKNOWN/REVIEW không release/settle.
Legacy Mock PAY_ORDER hash/replay/payment_id attribution giữ nguyên ở MOCK.
POST /payments trả403 PAYMENT_PROVIDER_DISABLED khi VNPAY mode active kể cả old key;
MOCK cũng chặn dùng gateway Order để bypass outcome.

## Runtime gate và bảo mật

PAYMENT_PROVIDER_MODE mặc định MOCK, không cần merchant credentials. VNPAY mode
fail startup ngoài controlled synthetic configuration: NODE_ENV=test + explicit
test flag + loopback brewlite_b2a_<12hex>_test + DATABASE_URL=TEST_DATABASE_URL +
TEST0001/synthetic fixture secret/callback.example.org. Chỉ NODE_ENV=test không đủ.
Không development/production enable switch, Customer override hoặc Mock fallback.
Tests inject parsed config vào isolated Nest app; không gọi provider HTTP, không
actual merchant values. Không log signed URL/secret; errors generic/sanitized.

## Verification — current source

| Check | Kết quả |
| --- | --- |
| Backend unit/HTTP |501/501,17 suites; giữ481 baseline +20 new |
| Real PostgreSQL |528/528,21 suites; giữ492 baseline +36 initiation, gồm14 FIX01 |
| Frontend regression |191/191; frontend source không sửa |
| Backend/frontend lint, typecheck, build |PASS; frontend build từ source copy tránh generated next-env mutation |
| Prisma validate/generate/status/diff |PASS;13 completed, up to date, no difference |
| Development READ ONLY audit |19 full-table fingerprints và catalog/13 ledger/checksums trước=sau |
| Preserved frontend/next-env.d.ts |SHA256 unchanged; excluded from commit |
| Actual VNPAY Sandbox / E2E |NOT RUN, không tuyên bố PASS |

PG tests gồm durable/signed server amount, replay sau expiry, same/different-key
races, unique ref/pending, retry cycle2/FIX01/no fake terminal/Award/Cart clear,
stock/points/debt rollback, technical fault sau stock update, cancellation/status
race reread, UNKNOWN/REVIEW/unprocessed receipt, owner/role/strict DTO/pagination,
paid cancellation và success-review semantics, Mock compatibility/gate OFF.
Synthetic VERIFIED/terminal records là isolated test fixtures để mô hình trusted
history, không provider verification implementation hoặc bằng chứng Sandbox.
Existing financial suites chạy đủ: Mock, L01, inventory, orders, idempotency,
Promotion/BREW10K và A07 history. Baseline suites không bị bỏ/skip.

Machine-readable evidence (evidence kiểm thử cũ đã dọn) chứa source hashes,
full19 fingerprints và current test counts. Isolated DB là clone từ FIX01 isolated
13-migration public snapshot đã so business fingerprints/catalog; ledger13 checksum
đúng dù isolated application row id/time khác development. Tests chỉ mutate/drop
owned schemas trong isolated DB; development được đọc repeatable-read READ ONLY.

## Risks và phase tiếp theo

Chưa có IPN receipt/apply/recovery, Return resolver, QueryDr/reconciliation,
zero-total completion hay Checkout integration; gateway activation vẫn cần approval
riêng sau các prerequisite. Unknown giữ resources/Cart theo P00, không có TTL release.
Test results không khẳng định merchant configuration, callback ingress, ngân hàng
Sandbox, full browser/payment E2E hoặc NFR latency certification. Existing pg query
deprecation warnings là baseline test-harness warning, không failed assertions.
P01-B2B có thể được giao tiếp; task này dừng sau local commit/report.

---

## Hồ sơ blocker gốc — verbatim, superseded by FIX01 and resumed implementation

# P01-B2A — VNPAY initiation implementation: BLOCKED

Baseline: `b6518bccd2eff81357dc3d66fbb20cdab5c2ff81`.
Audit: 2026-10-17. **P01-B2A BLOCKED — APPROVAL REQUIRED**.

Không có application implementation trong task này. Đã gặp điều kiện STOP tại
§4 và §9 của yêu cầu P01-B2A: schema hiện hành chưa hỗ trợ attribution hợp lệ cho
durable Loyalty reservation của gateway retry trước khi có terminal Payment.
Không sửa P00/L00/L01, migration đã apply, schema, business rules hoặc runtime gate.

## Blocker B2A-01 — retry Loyalty RESERVE cần Payment chưa tồn tại

[P00 §5](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md) yêu cầu Order PAYMENT_FAILED chỉ
retry sau verified failure đã APPLIED. Transaction initiation phải reacquire tồn,
reserve đúng điểm/cycle mới và commit durable Attempt trước khi phát URL; chưa
được tạo Payment terminal, PAID hoặc Award khi outcome chưa biết.

Nhưng [L00 §17](L00_LOYALTY_REDEMPTION_CONTRACT.md) quy định retry RESERVE cycle>1
phải có Payment attribution. Constraint hiện hành tại
[L01 migration](../backend/prisma/migrations/20261014090000_loyalty_redemption/migration.sql)
dòng41 và45–54 xác nhận:

```sql
FOREIGN KEY (payment_id) REFERENCES payments(id)

kind='RESERVE' AND points>0 AND cycle>1
AND payment_id IS NOT NULL
AND effect_key='PAY_ORDER:'||payment_id::TEXT
```

Prisma PaymentStatus chỉ có SUCCEEDED/FAILED; không có pending Payment.
[Mock PaymentService](../backend/src/payments/payment.service.ts) có thể tạo
Payment terminal và persist RESERVE trong cùng transaction đồng bộ. Gateway
initiation phải commit trước khi biết outcome nên không dùng được cách đó.

Đường đi cụ thể bị chặn: Order đã dùng50 điểm, cycle1 đã release sau gateway
failure verified+APPLIED; retry phải reserve50 điểm ở cycle2 trước redirect.
RESERVE không có Payment vi phạm CHECK. Preallocate UUID của Payment tương lai
vẫn vi phạm FK ngay lúc INSERT; FK thực tế không DEFERRABLE. Giữ transaction mở
tới callback không đáp ứng durable commit-before-response và không thuộc scope.

Gắn reservation mới vào Payment FAILED của cycle trước thay đổi nguồn attribution
đã frozen, không phải cơ chế Attempt attribution được duyệt. Nó còn có thể đụng
UNIQUE(effect_key,kind) nếu Payment đó đã là nguồn RESERVE của một Mock retry cũ.
Không dùng cách này làm workaround. Tạo Payment FAILED/SUCCEEDED giả cũng vi phạm
điều kiện initiation và bảo toàn lịch sử tài chính.

P01-B1 thêm Attempt/Verification nhưng không thêm nguồn attribution từ các đối
tượng này vào LoyaltyEntry. P01-B1 structural PASS và preservation vẫn hợp lệ;
chúng không chứng minh gateway retry accounting đã được implement.

## Bằng chứng thực tế và preservation

Development được đọc bằng repeatable-read READ ONLY, identity
`brewlite_dev/public`, tại `2026-10-17T01:31:23.587Z`:

- 12 migrations completed; không failed/rolled-back rows;12 SQL checksums khớp.
- Catalog có CHECK `loyalty_entries_attribution_check` và FK
  `loyalty_entries_payment_id_fkey`, đều validated; FK không deferred/deferrable.
- Cả19 full-table fingerprints khớp final post-apply P01-B1, gồm migration ledger,
  Orders, Payments, Promotion/BREW10K, inventory, users/balances/debt, journal,
  reservations/idempotency và hai bảng gateway trống.
- `frontend/next-env.d.ts` giữ SHA256
  `0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc`.

Hai PostgreSQL probes trên database isolated đã có
`brewlite_p01b1_4c11bd1c3a0a_test`, sử dụng temporary tables và rollback:

| Probe | Kết quả |
| --- | --- |
| RESERVE cycle2, payment_id NULL | Bị từ chối SQLSTATE23514, CHECK thật được copy bằng LIKE INCLUDING CONSTRAINTS |
| RESERVE cycle2 trỏ UUID Payment tương lai | Bị từ chối SQLSTATE23503, FK tương đương tới temporary Payment table rỗng |

Probe thứ hai kiểm chứng hành vi FK PostgreSQL với bảng tạm, không phải INSERT
vào bảng development. Không có provider verification fixture, transaction VNPAY,
Payment hoặc Award được tạo. Public fingerprints isolated giữ nguyên trước/sau.
Log/evidence cục bộ: `.tmp/p01b2a-blocker.cjs` và `.tmp/p01b2a-blocker.json`.

## API, transaction, idempotency và feature gate

Ba APIs được giao vẫn **NOT IMPLEMENTED**:

| API | Trạng thái |
| --- | --- |
| POST /payments/vnpay/attempts | Chưa tạo; không phát URL hoặc durable Attempt |
| GET /payments/attempts/:attemptId | Chưa tạo |
| GET /orders/:id/payment-attempts | Chưa tạo |

Contract dự kiến vẫn là P00: CUSTOMER JWT/current DB role/ownership, strict DTO,
PAY_ORDER + VNPAY_INITIATE_V1, exact response replay, owner→Order→Attempts→Claim
lock order, unsigned immutable snapshot và local signing trước durable commit.
Không chọn contract/cursor/gate mới hoặc thay namespace trong bước audit này.
Runtime Mock, historical claims và P01-A pure signing helpers giữ nguyên.
VNPAY chưa được nối hoặc enable; không credentials, external calls, IPN, settlement,
querydr, Checkout hoặc frontend changes.

## Checks và giới hạn

| Check | Kết quả mới trong P01-B2A |
| --- | --- |
| Git baseline / schema /12 migration checksum audit | PASS |
| Prisma validate | PASS |
| Prisma migration status | PASS,12 migrations, up to date |
| Read-only development fingerprint audit | PASS,19 tables khớp P01-B1 |
| Isolated blocker probes | PASS,2 expected rejections; rollback/public preservation |
| Backend lint/typecheck/build | NOT RUN, không có application changes; STOP trước implementation |
| Unit/HTTP/full PostgreSQL/financial regression | NOT RUN; hai probes không thay thế mandatory suites |
| Actual Sandbox / browser E2E | NOT RUN |

P01-B1 test counts là historical evidence, không báo thành P01-B2A PASS.
Không stage hoặc commit vì mandatory implementation tests chưa PASS.

## Approval cần thiết trước khi tiếp tục

Chưa tự chọn một trong hai hướng sau:

1. Phê duyệt task thiết kế attribution cho asynchronous gateway reservation và
   migration additive riêng sau review. Phải chỉ rõ nguồn Attempt/Claim, uniqueness,
   FK, journal reconciliation, compatibility L00/L01 và frozen-contract approval
   cần thiết; test isolated trước mọi development apply. Không sửa12 migrations cũ.
2. Phê duyệt thu hẹp P01-B2A chỉ initiation cho PENDING đã có reservations và status
   APIs, reject toàn bộ PAYMENT_FAILED initiation trong phase này. Gateway retry
   có Loyalty tiếp tục BLOCKED và không tuyên bố hoàn thành P00 retry acceptance.

Đây là các lựa chọn xin quyết định, không phải business rule đã được duyệt.
P01-B2B/IPN implementation chưa sẵn sàng; không tự chuyển phase.
