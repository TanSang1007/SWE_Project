# P01-B2C2 ZERO-TOTAL CONFIRMATION RESULT

Ngày audit: 2026-10-17. **P01-B2C2 BLOCKED — APPROVAL REQUIRED**.
Chưa triển khai endpoint hoặc thay đổi accounting. Đây là báo cáo contract gate,
không phải implementation completion/regression evidence.

## Baseline và phạm vi

HEAD khớp expected `f0a09ecdb7b66779990a461241ab0f14cf333869`.
Trước task chỉ có `frontend/next-env.d.ts` modified. Giữ nguyên working-copy SHA256
`0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc`, không stage.
Lượt này chỉ thêm báo cáo này; không application/schema/migration/env/package edits.
Không truy cập PostgreSQL hoặc tạo synthetic Order/Payment/journal trong development.

Reported baseline627 backend/635 PostgreSQL/191 frontend PASS thuộc P01-B2C1,
không phải test run của P01-B2C2. Repository có13 migration directories; applied
ledger/19 development fingerprints chưa đo lại trong lượt audit này.

## B2C2-01 — Award record policy khác frozen contract

Task hiện tại §5 yêu cầu không cấp Loyalty Award khi finalTotal=0; §7 ghi rõ
**“Không ghi Loyalty Award”** cho zero-total without Loyalty. Trong khi đó:

| Source of truth / source code | Yêu cầu hiện hành |
| --- | --- |
| [P00 §14 D01/A](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md#14-zero-total--d01a-user-approved) | Atomic INTERNAL_ZERO Payment0 + PAID + SETTLE nếu có redemption + Award0/EARN0 + purchased Cart clear |
| P00 acceptance P25 trong cùng contract | Duplicate confirmation chỉ có đúng một zero Payment/Award0 |
| [L00 §4/10/14](L00_LOYALTY_REDEMPTION_CONTRACT.md) | Award kể cả0 tại PAID; zero Mock giữ award0; successful payment giữ atomic award0 |
| [L01 implementation](L01_LOYALTY_REDEMPTION_IMPLEMENTATION.md) / [PaymentService](../backend/src/payments/payment.service.ts) | Success luôn create LoyaltyAward với floor(total/10000), kể cả0, và journal EARN0 |
| [reconcileAccount](../backend/src/loyalty/loyalty-accounting.ts) | Order có redemption SETTLED/REFUNDED phải có đúng một EARN và LoyaltyAward; EARN/REVERSE phải bind đúng Award |
| [OrderService.transitionOrder](../backend/src/orders/order.service.ts) | PAID cancellation cần unreversed LoyaltyAward; thiếu Award sẽ rollback với workflow unavailable |

`floor(0/10000)=0` xác định số điểm được cấp bằng0; không tự quyết định có hay không
một Award record0. Hai representation khác nhau về journal proof và cancellation.
Không tự diễn giải câu “Không ghi Loyalty Award” thành “ghi record points0”, cũng
không tự bỏ Award0/EARN0 đã được frozen contract yêu cầu.

Làm theo yêu cầu mới mà bỏ các records0 sẽ cần amendment rõ phạm vi cho P00/L00,
account reconciliation và paid cancellation, cùng tests tương ứng. Chưa kết luận
amendment đó bắt buộc migration; không sửa CHECK hoặc nới accounting để vượt gate.

Authority cho STOP: task hiện tại §2 yêu cầu STOP nếu cần business contract amendment;
§13 yêu cầu không nới constraints hoặc chấp nhận double-settle/regression. Repository
instructions cũng yêu cầu chờ câu trả lời cho decision còn mở. Approval triển khai
B2C2 không tự chọn thay người dùng giữa hai chỉ dẫn xung đột này.

### Quyết định cần người dùng xác nhận

- **A — Giữ P00:** ghi đúng một INTERNAL_ZERO Payment0, Award(points0) và EARN0;
  không cộng điểm khả dụng. SETTLE redemption khi có. Cụm “không ghi Award” trong task
  được thay bằng “không cấp điểm dương; giữ accounting records0 theo P00”. Đây là
  lựa chọn ít thay đổi contract/invariants hiện có nhất, chưa được tự coi là đã chọn.
- **B — Không ghi Award0/EARN0:** phê duyệt một amendment riêng, xác định proof và
  paid-cancellation behavior cho INTERNAL_ZERO. Giữ historical Mock/IPN/QueryDr
  semantics. Audit schema/SQL trước; migration nếu cần vẫn phải xin approval riêng.

## Representation đã xác nhận từ schema, không phải blocker

[P00 §8/14](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md) đã định nghĩa Payment cho internal
confirmation. [Migration foundation](../backend/prisma/migrations/20261015170100_vnpay_database_foundation/migration.sql)
`payments_provider_check` có nhánh:
`provider=INTERNAL_ZERO`, `method=ZERO_TOTAL`, `amount=0`, `status=SUCCEEDED`,
`gateway_attempt_id IS NULL`, `confirmed_at IS NOT NULL`.
[Payment methods migration](../backend/prisma/migrations/20261015170000_vnpay_payment_methods/migration.sql)
và [Prisma schema](../backend/prisma/schema.prisma) có enums tương ứng.

Do đó Payment0 có representation nội bộ hợp lệ và được contract thiết kế rõ;
không phải VNPAY/Mock success giả. Không có bằng chứng cần migration cho Payment0.
Không tạo Attempt, Verification, transaction number hoặc signed provider payload.
Blocker hiện tại là Award-record policy, không phải Payment amount0 bị cấm.

## Phần implementation đã được contract định nghĩa, chưa thực hiện

- API: CUSTOMER/JWT/current DB role POST `/orders/:id/confirm-zero`, owner UUID,
  strict empty body/query, required Idempotency-Key;200 terminal internal completion.
  Không nhận amount/status/provider/outcome từ client; không tự confirm lúc create.
- Eligibility: exact Decimal total0, PENDING/snapshots/reservation hợp lệ, no prior
  success/Award/conflicting financial state, no pending external Attempt/UNKNOWN/
  REVIEW/unprocessed verified receipt; không reprice. Không tự mở flow từ
  PAYMENT_FAILED khi chưa có quy tắc rõ, không positive/negative amount bypass.
- Transaction dự kiến: owner→Order→Attempts/receipts/claim locks theo infrastructure
  hiện có; authoritative reread/account proof/debt gate, complete all writes hoặc
  rollback toàn bộ. Payment/confirmedAt/Order PAID/paidAt, SETTLE đúng held cycle nếu
  redeemedPoints>0, purchased Cart clear và completed claim cùng transaction.
- Inventory đã debit lúc Order create; success không debit lần hai. Không double
  RESERVE/SETTLE, không RELEASE trong success; Award/EARN behavior chờ quyết định trên.
- Idempotency: giữ PAY_ORDER namespace, discriminator `{action:"ZERO_COMPLETE_V1",orderId}`
  theo P00; same key/hash replay stable, different-order/action conflict, không đổi
  historical Mock hashes/claims. Replay không được clear Cart/settle lần nữa.
- Concurrency: owner/Order guards phải bảo toàn confirm/cancel/initiation races;
  UNKNOWN/REVIEW luôn chặn. Chưa chạy tests nên chưa tuyên bố implementation an toàn.
- Feature gate: giữ mặc định MOCK, gateway OFF và disabled QueryDr transport;
  internal confirmation không phụ thuộc merchant credentials hoặc gọi network.

## Kết quả theo22 mục báo cáo

| Mục | Trạng thái lượt này |
| --- | --- |
| 1. Git baseline | HEAD khớp expected f0a09ecdb7b66779990a461241ab0f14cf333869 |
| 2. Files changed | Chỉ thêm báo cáo này |
| 3. API implemented | Chưa triển khai; P00 route đã xác định rõ |
| 4. Zero eligibility | Contract đã audit; chưa implementation/test |
| 5. Representation | INTERNAL_ZERO/ZERO_TOTAL Payment0 hợp lệ; Award policy BLOCKED |
| 6. Atomic transition | Chưa triển khai; không thay Order |
| 7. Loyalty settlement | Không journal writes; chờ quyết định Award0/EARN0 |
| 8. Inventory | Không stock/OCC writes |
| 9. Cart | Không Cart writes |
| 10. Idempotency | Không tạo/sửa claims; discriminator thiết kế giữ theo P00 |
| 11. Concurrency/race | NOT RUN |
| 12. Feature gate | Không config/env changes; không gateway activation |
| 13. Mock/IPN/QueryDr | Không sửa source; regression NOT RUN |
| 14. Backend tests | NOT RUN;627 là reported baseline |
| 15. PostgreSQL tests | NOT RUN;635 là reported baseline |
| 16. Frontend regression | NOT RUN;191 là reported baseline |
| 17. Prisma/lint/typecheck/build | NOT RUN do dừng ở contract gate, không code/schema change |
| 18. Development fingerprints | Không đo lại19; không truy cập/ghi DB |
| 19. Remaining blockers | B2C2-01; cần xác nhận A hoặc amendment B |
| 20. Git status | Báo cáo mới untracked; next-env modified từ trước/byte-exact/không stage |
| 21. Local commit | Không tạo vì implementation/mandatory tests chưa hoàn thành; không push |
| 22. Readiness P01-C | Chưa đạt; không tự triển khai Return/Checkout |

Kiểm tra riêng tài liệu: local links/anchors, trailing whitespace, scope, scoped
secret patterns và next-env SHA256. Không cài package để kiểm Markdown. P00/FIX01/
L00 và các report cũ giữ nguyên; không đánh dấu Development Plan hoàn thành.

External QueryDr compatibility vẫn **EXTERNAL SANDBOX RESPONSE VERIFICATION PENDING**.
Actual Sandbox E2E **NOT RUN**. Activation vẫn cần representative actual signed
QueryDr responses hoặc technical confirmation của VNPAY cho optional canonicalization,
cùng merchant/callback/network prerequisites đã ghi ở P01-B2C1. Không dùng secret
thực, không deploy/ngrok/Refund hoặc actual VNPAY calls trong task này.

---

## APPROVED DECISION A — PRESERVE P00 §14

2026-10-17: người dùng chính thức chọn **OPTION A**. Yêu cầu cũ “Không ghi Loyalty
Award” được thay thế: ghi đúng một Award(points=0) và EARN0, không cộng điểm khả dụng,
không tự thay đổi debt; giữ bằng chứng cho reconcile/paid cancellation. Không sửa
P00 §14 hoặc tạo amendment B. Original blocker phía trên được giữ nguyên làm lịch
sử; trạng thái NOT IMPLEMENTED/NOT RUN ở phần đó thuộc lượt audit trước approval.

## Implementation

### API contract và representation

CUSTOMER POST `/orders/:id/confirm-zero`, JWT/current role lấy từ database qua guards,
UUID `id`, strict empty JSON body/query, required Idempotency-Key ASCII printable
1..128. Không nhận amount/status/provider/outcome từ client. Framed non-JSON body và
array bị reject; không tạo route Admin force-paid hoặc auto-confirm lúc Order create.
Controller đăng ký qua PaymentModule; không sửa existing Order/Mock/IPN/QueryDr services.

200 normalized response:

```json
{
  "payment": {
    "id": "<internal-payment-uuid>",
    "orderId": "<owned-order-uuid>",
    "provider": "INTERNAL_ZERO",
    "status": "SUCCEEDED",
    "amount": "0",
    "method": "ZERO_TOTAL"
  },
  "order": { "id": "<owned-order-uuid>", "orderCode": "<stored-code>", "status": "PAID" },
  "loyalty": {
    "awardedPoints": 0,
    "redeemedPoints": 900,
    "redemptionState": "SETTLED",
    "debtOffsetPoints": 0,
    "availablePointsAdded": 0
  },
  "cashRefundStatus": "NOT_APPLICABLE"
}
```

No-redemption response có redeemedPoints0/redemptionStateNONE. Payment0 là terminal
internal record đúng schema/P00, không phải Mock outcome hoặc VNPAY success giả.
Không Attempt/Verification/provider transaction identifier, signed URL hoặc merchant
credentials. confirmedAt của Payment bằng paidAt của Order, lưu cùng transaction.
Response không chứa key/hash/journal/customer credentials; private/no-store/max-age0,
Vary Authorization/Origin, exact replay header `Idempotency-Replayed: true`.

Errors:401 missing/invalid JWT;403 role khác CUSTOMER;404 missing/cross-owner Order,
kể cả trước replay;400 strict DTO/key lỗi;422 PAYMENT_AMOUNT_UNSUPPORTED cho total
khác exact0;409 ORDER_ALREADY_PAID/INVALID_ORDER_STATE/PAYMENT_PENDING/
PAYMENT_REQUIRES_REVIEW/LOYALTY_REVERSAL_OUTSTANDING/IDEMPOTENCY_KEY_REUSED/
IDEMPOTENCY_IN_PROGRESS/CONCURRENT_UPDATE;503 PAYMENT_UNAVAILABLE cho invariant hoặc
technical failure. Không trả technical exception/raw payload.

### Eligibility và transaction boundary

Owner User→Order→Attempts ID ASC→receipts ID ASC→claim/Cart writes; giữ50ms maxWait,
400ms transaction, lock200ms/statement300ms/UTC như các payment engines hiện có.
Ownership lookup trước replay; owner/Order locks rồi authoritative reread, không
dùng client state. Chỉ PENDING/unpaid/no existing Payment/Award; PAID/new key và
CANCELLED bị chặn. PAYMENT_FAILED không được internal retry/reacquire. ZERO flow
chỉ initial reservation cycle1 (hoặc cycle0/NONE khi không redemption).

Shared gateway guard chặn pending/UNKNOWN/REVIEW/unprocessed VERIFIED receipts;
thêm fail-closed nếu có bất kỳ gateway history nào trên zero Order. Gate chạy trước
amount check để positive Order có unresolved gateway không thể dùng internal flow
bypass. Gateway initiation cùng owner/Order locks và gateway positive-amount rule
ngăn tạo Attempt0, không phụ thuộc thứ tự race.

Exact Decimal zero; kiểm stored subtotal bằng tổng item lineTotal, unitPrice bằng
base+size+topping snapshots, lineTotal bằng unitPrice×qty; whole/nonnegative monetary
values, qty bounds, Promotion discount và Loyalty100VND/point arithmetic, original
reservation state/cycle. Không đọc lại giá/options/Promotion eligibility hiện tại,
không reprice hoặc sửa total. PostgreSQL CHECKs tiếp tục chặn persisted negative
amount; unit tests còn kiểm negative/fractional/nonfinite totals fail closed.

`reconcileAccount` chứng minh reservation/account/journal dưới owner lock;
`reservationGate` giữ quy tắc debt cho positive redemption. Purchased Cart phải có
đủ quantity cho mỗi stored configuration; aggregation không xóa extra/unrelated
Cart quantities. Không cố suy ra hoặc ghi lại lịch sử inventory: stock đã được debit
trong Order creation; confirmation không mutate Product stock/version lần nữa.

Sau eligibility: tạo PAY_ORDER PROCESSING claim, CAS PENDING→PAID/version+1/local
paidAt/redemptionSETTLED nếu có, tạo INTERNAL_ZERO Payment0/confirmedAt, SETTLE đúng
cycle khi r>0, Award0, EARN0, clear purchased quantities, persist account/journal,
complete claim200/body cùng transaction. Không gọi provider/Mock và không commit
effect riêng. Lỗi ở bất kỳ bước nào rollback toàn bộ; không fake FAILED Payment.

### Accounting proof và paid cancellation

- Initial RESERVE giữ nguồn CREATE_ORDER/cycle1; không RESERVE lại tại confirmation.
- SETTLE có nguồn PAY_ORDER:<internal Payment0>, points đúng redeemedPoints, giảm
  reserved một lần; không tự RELEASE ở success.
- Award0 unique theo Order; EARN0 unique theo Order/kind và Payment effect key,
  available/reserved/debt deltas đều0. Không cộng điểm thưởng dương hoặc bù debt bằng0.
- No-redemption Order có EARN0/Award0, không SETTLE0; debt hiện có giữ nguyên. Positive
  redemption bị debt gate chặn như L01, không tự dùng future earn để hợp thức hóa.
- Existing B16/A03 paid cancellation dùng Award0/reversedAt: giữ Payment SUCCEEDED/
  amount0/confirmedAt và Order paidAt, restore stock đúng snapshot một lần, REFUND
  redeemed points nếu có, REVERSE0 không tạo điểm thưởng/debt khác0. Repeated cancel
  no-op. `reconcileAccount` PASS trước/sau; không sửa accounting hoặc FIX01 constraints.

### Idempotency và concurrency

Giữ PAY_ORDER namespace, SHA256 JSON `{action:"ZERO_COMPLETE_V1",orderId}` theo P00;
không thêm enum operation hoặc đổi historical Mock hashes. Same key/order trả exact
stored200/body kể cả sau paid cancellation; caller đọc Order GET để biết current
state. Replay không clear Cart mới, không cấp Award/EARN/SETTLE lần nữa. Same key
khác order/action conflict. CREATE_ORDER namespace có thể dùng cùng key mà không sửa
claim gốc. Ownership check trước replay và recovery, không cross-owner data leak.

Không tự retry financial transaction. Sau rollback chỉ recovery-read claim cùng
owner; unique/lock/serialization conflicts báo retry cùng key. SQL uniques cộng
owner/Order locks chống double confirmation và serialize Mock/zero/cancel/gateway
races. Invalid/inconsistent snapshots hoặc thiếu purchased Cart rollback không để
orphan Payment/Award/journal/claim. No gateway evidence được tạo để reuse settlement.

### Feature gate và external limitations

Normal provider mode vẫn MOCK; VNPAY startup gate synthetic-isolated và default
QueryDr transport disabled không đổi. Internal zero service không inject gateway
configuration, Mock hoặc transport; không cần VNPAY credentials và không fallback.
Zero API chỉ hoạt động khi total từ database bằng0, không mở positive-paid bypass.

QueryDr **EXTERNAL SANDBOX RESPONSE VERIFICATION PENDING** như B2C1. Actual Sandbox
E2E **NOT RUN**; không merchant secret thực, live calls/activation, scheduler, Refund,
Return/Checkout UI, deploy, ngrok hoặc push. P01-C là task riêng sau report này.

## P01-B2C2 ZERO-TOTAL IMPLEMENTATION RESULT

**P01-B2C2 COMPLETE — READY FOR RETURN & CHECKOUT**.

| Mục | Kết quả lượt resume |
| --- | --- |
| 1. Git baseline | `f0a09ecdb7b66779990a461241ab0f14cf333869`, khớp expected |
| 2. Decision A | Applied; P00 §14 giữ nguyên, blocker history giữ nguyên byte-prefix |
| 3. Files changed |13 files:6 backend,6 Docs,README; existing engine edits chỉ PaymentModule wiring |
| 4. API | CUSTOMER POST /orders/:id/confirm-zero,200, strict empty DTO/key/ownership/no-store |
| 5. Payment0 | Một INTERNAL_ZERO/ZERO_TOTAL/SUCCEEDED/amount0, confirmedAt, no gateway Attempt |
| 6. Eligibility/ownership | Initial PENDING/exact Decimal0/account/snapshot/Cart proof; cross-owner404 trước replay; gateway conflicts blocked |
| 7. Atomic settlement | Payment/PAID/paidAt/SETTLE/Award0/EARN0/Cart/claim cùng transaction;5 fault-injection boundaries rollback PASS |
| 8. Award0/EARN0 | Persisted đúng một lần, points0 và deltas0; no-redemption không tạo SETTLE0 |
| 9. Balance/debt | Reconcile PASS; available không tăng, held settlement đúng một lần, debt gate/conservation PASS |
| 10. Paid cancellation | Existing B16 path PASS cả redemption/no redemption: restore stock/REFUND/REVERSE0; preserve Payment0/paidAt; repeated cancel no-op |
| 11. Inventory/Cart | Real Order creation debit10→9; confirmation không debit/version-bump lần nữa; clear purchased once/retain extras; replay không clear Cart mới |
| 12. Idempotency/concurrency | Same-key replay, cross-order/action conflicts, shared CREATE_ORDER/PAY_ORDER key, same/different-key concurrent confirmation, cancel/Mock/gateway races PASS |
| 13. Positive bypass | Positive/negative/fractional/nonfinite total rejection; gateway UNKNOWN/REVIEW/receipt blocking; no client amount/status/provider/outcome |
| 14. Mock/IPN/QueryDr | Original engines/claims/hashes/accounting source untouched; all baseline627 backend/635 PostgreSQL names retained and PASS |
| 15. Backend |23 suites/667 tests PASS, gồm40 new unit/HTTP |
| 16. PostgreSQL |24 suites/667 tests PASS, gồm32 new B2C2 cases trong database clone/UUID schema cô lập |
| 17. Frontend |191 tests PASS; frontend code không đổi; build từ source copy |
| 18. Prisma/tooling | validate/status/diff PASS/no schema drift; both lint/typecheck/build PASS |
| 19. Development | READ ONLY pre/post13 ledger/checksums/19 fingerprints/catalog/functions/sequences giữ nguyên; no synthetic development writes |
| 20. Remaining blockers | B2C2-01 resolved bởi Decision A; không implementation blocker; external QueryDr/live prerequisites vẫn PENDING |
| 21. Git status | Chỉ stage scope task; next-env modified từ trước, byte-exact/không stage |
| 22. Local commit | Authorized sau mandatory checks/review PASS; SHA ở final response/Git history, không self-embed trong commit |
| 23. P01-C readiness | READY cho task Return/Checkout riêng; không tự triển khai |

Machine-readable evidence (evidence kiểm thử cũ đã dọn) có source hashes, check exits,
baseline-name conservation và preservation results. Synthetic fault triggers chỉ
được tạo/xóa trong schema test riêng, không sửa migration hoặc development constraints.
Stored negative Order total bị existing PostgreSQL CHECK cấm; unit tests kiểm guard
negative/near-zero để không cần nới CHECK tạo fixture sai. Integration gateway guards
dùng legitimate positive Attempt; không tạo fake zero gateway evidence để test.

Validation bổ sung: scoped secret/private-key scan, local file links/anchors,
original blocker byte-prefix, frozen P00/L00/FIX01/history and prior gateway source
hashes, whitespace/diff scope và next-env SHA256 PASS. Existing pg concurrent-query
deprecation notices và expected negative-path503 logs không là failed assertions.
Không xóa/skip baseline tests hoặc install package. Actual Sandbox E2E **NOT RUN**.
