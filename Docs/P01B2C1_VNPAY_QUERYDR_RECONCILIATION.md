# P01-B2C1 VNPAY QUERYDR & RECONCILIATION RESULT

Ngày kiểm tra: 2026-10-17. **P01-B2C1 BLOCKED — APPROVAL REQUIRED**.
Đây là báo cáo protocol gate, không phải implementation hoặc bằng chứng regression.
Không đánh dấu P01-B2C1 hoàn thành trong Development Plan.

## Baseline và phạm vi thực tế

- HEAD khớp expected: `f62445b8ece0dd777843b97b7aec5308a8b7694b`.
- Trước khi làm việc chỉ có `frontend/next-env.d.ts` modified; không sửa/stage file này.
  SHA256 working copy: `0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc`.
- Thay đổi được tạo trong lượt này: duy nhất báo cáo Markdown này.
- Không sửa application code, schema, migration, package, env hoặc business contract.
- Chỉ tải tài liệu/demo tĩnh chính thức vào `.tmp/b2c1-protocol/` (Git ignored).
  Không chạy demo; không gọi transaction endpoint, PAY, QueryDr hoặc Refund.
- Có 13 migration directories trong repository. Không truy cập PostgreSQL, không
  apply migration hoặc tạo synthetic gateway records trong development.

## B2C1-PROTOCOL-01 — thiếu đối chiếu độc lập cho response signing

User task §3 yêu cầu khi official documentation có typo hoặc optional signing chưa
rõ phải đối chiếu demo chính thức và test vector độc lập, nếu vẫn không xác định
được chính xác thì STOP. §14 yêu cầu STOP nếu không thể xác minh provider response.

[P00 §12](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md#12-querydr-reconciliation--approved-design-chưa-triển-khai)
đã pin một profile response gồm 15 trường, giữ empty segments cho optional absent.
Đây là quyết định đã duyệt và được giữ nguyên. Không phát hiện bằng chứng rằng P00
sai; cũng chưa có bằng chứng độc lập xác nhận provider xử lý optional absent theo
profile đó. Báo cáo này không tuyên bố có mâu thuẫn business contract đã được chứng minh.

Đối chiếu trực tiếp:

| Nguồn chính thức | Kết quả kiểm tra |
| --- | --- |
| [Web QueryDr](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html), response checksum | Có lỗi thiếu toán tử nối trước BankCode; Command/PayDate/Promotion fields optional; không có signed response test vector cho trường vắng mặt |
| [Techspec 2.1.0 được giao](https://sandbox.vnpayment.vn/apis/files/VNPAY%20Payment%20Gateway_Techspec%202.1.0-VN.pdf), §2.5.4 | Dùng tên request cũ TransDate; response không cung cấp vector xác nhận chuỗi 15 trường/empty optional của web profile |
| [Official downloads](https://sandbox.vnpayment.vn/apis/downloads/) — Node.js | `routes/order.js`, POST querydr: ký request pipe-separated, callback chỉ console.log response |
| C# demo trên cùng trang | `vnpay_querydr.aspx.cs`: ký request, hiển thị raw response; không verify QueryDr response |
| PHP demo trên cùng trang | `vnpay_querydr.php`: ký request, decode/hiển thị response; không verify QueryDr response |
| Python demo trên cùng trang | `views.py`, query: kiểm tra request signing/response handling; không có QueryDr response signature verification |
| Java demo trên cùng trang | `vnpayQuery.java`: ký request/gửi POST/đọc response; không có QueryDr response signature verification |

Không lấy PAY/IPN signature verification trong các demo làm bằng chứng QueryDr
response: hai canonical protocols khác nhau. Không sử dụng secret trong cấu hình
demo hoặc secret merchant thật. Không dùng SDK/community code làm authority.

Một vector tự tạo bằng Python/Node từ cùng profile P00 có thể kiểm tra tính nhất
quán cryptographic implementation, nhưng không tự xác nhận cách provider biểu diễn
optional absent. Chưa tạo hoặc gọi một vector như vậy là provider-verified evidence.

### Bằng chứng cần để tiếp tục

Cần reference/vector độc lập cho QueryDr **response** xác nhận thứ tự 15 trường và
quy tắc optional absent/empty, đặc biệt hai promotion fields cuối. Có thể là fixture
chính thức dùng secret synthetic hoặc xác nhận protocol từ VNPAY kèm vector có thể
tính lại offline. Không cần và không yêu cầu secret merchant thật.

Nếu người dùng muốn tiếp tục chỉ theo pinned P00 profile và independent synthetic
HMAC vectors, cần xác nhận rõ rằng mức chứng minh đó đáp ứng gate §3 trong task này;
không tự coi đó là provider corroboration. Không yêu cầu thay mapping tài chính,
schema hoặc cho phép gọi API thật để vượt gate.

## Thiết kế đã xác định, chưa triển khai

Request canonical: raw UTF-8, pipe-separated theo thứ tự
`RequestId|Version|Command|TmnCode|TxnRef|TransactionDate|CreateDate|IpAddr|OrderInfo`
(tên wire đều có tiền tố `vnp_`). HMAC-SHA512; không dùng PAY query-string encoder.
Demo request xác nhận cùng thứ tự. TransactionDate phải là immutable PAY CreateDate
GMT+7; query CreateDate là thời gian inquiry mới. Không dùng now/PayDate thay ngày PAY.
RequestId random hex32 phải durable unique; optional request TransactionNo được omit
theo P00. Chưa có request builder hoặc request signature test trong lượt này.

Response canonical dự kiến giữ nguyên P00: ResponseId, Command, ResponseCode,
Message, TmnCode, TxnRef, Amount, BankCode, PayDate, TransactionNo, TransactionType,
TransactionStatus, OrderInfo, PromotionCode, PromotionAmount. Không triển khai verifier
hoặc fallback thử nhiều canonical variants khi gate còn mở.

P00 phân biệt inquiry ResponseCode với transaction status: 00/type01/status00 mới
classify success; 00/type01/status02 classify failure. Query91/not found, transport
failure và timeout không chứng minh payment failed hoặc cho phép release/retry.
Mâu thuẫn/unsupported states giữ REVIEW, không overwrite terminal Payment/refund.

Client tương lai phải injectable, fixed Sandbox HTTPS endpoint, TLS verification,
timeout5s có abort, bounded response bytes, không follow redirects, không raw logs,
không network trong transaction. Chưa có transport hoặc env switch mới.

Reconciliation theo P00: ADMIN database RBAC/local-only, strict empty body/query,
một Attempt mỗi request, persisted recent REQUESTED gate dưới locks; không scheduler
hoặc unbounded batch/retry. Recovery VERIFIED chưa processed phải được ưu tiên trước
QueryDr. UNKNOWN giữ reservations; REVIEW không tự được clear bằng inquiry.

Schema hiện tại đã có QUERYDR source, requestId unique, queryCreateDate,
REQUESTED/VERIFIED/UNRESOLVED, normalized payload whitelist và evidence dedupe.
Chưa xác nhận đầy đủ runtime recovery bằng PostgreSQL tests; không đề xuất migration.

T1/T2 dự kiến reuse IPN settlement: hiện `IpnService` có private apply, đọc toàn bộ
VERIFIED receipts và interpret PAY status. Khi tiếp tục cần source-aware QueryDr
classification/equivalence để QueryDr00/status02 không bị diễn giải như IPN00/status02,
và compatible IPN decline/QueryDr failure không thành contradiction chỉ do API code
khác nhau. Không bypass HMAC, giả IPN fields hoặc tạo financial engine thứ hai.

## Kiểm chứng và 24 mục báo cáo

| Mục | Kết quả lượt này |
| --- | --- |
| 1. Git baseline/files | HEAD khớp; chỉ thêm báo cáo này |
| 2. Request signing | Đối chiếu official demo; chưa implementation/test |
| 3. Response verification | BLOCKED tại gate nêu trên |
| 4. GMT+7 | Xác định stored PAY CreateDate; chưa test |
| 5. Secure HTTP client | Chưa triển khai |
| 6. Selection/eligibility | P00 giữ nguyên; chưa triển khai |
| 7. Existing receipt recovery | Chưa triển khai |
| 8. T1/T2 reuse | Đã đọc IPN service; chưa sửa/extract |
| 9. IPN/QueryDr concurrency | NOT RUN |
| 10. UNKNOWN/REVIEW | Không thay policy/state |
| 11. Errors/timeouts | Chưa triển khai/test |
| 12. Financial idempotency | Không có financial writes; QueryDr tests NOT RUN |
| 13. Loyalty/Inventory | Không truy cập hoặc sửa DB; conservation không đo lại |
| 14. Mock regression | NOT RUN; không sửa Mock code |
| 15. Feature gate | Không đổi config/env, không kích hoạt VNPAY |
| 16. Unit tests | NOT RUN; 535 là reported baseline, không là kết quả lượt này |
| 17. HTTP tests | NOT RUN |
| 18. PostgreSQL tests | NOT RUN; 587 là reported baseline |
| 19. Full regression/Prisma checks | NOT RUN; frontend191 là reported baseline |
| 20. Development fingerprints | Không đo lại 19 fingerprints; không truy cập DB |
| 21. Blocker | B2C1-PROTOCOL-01 |
| 22. Git status | Báo cáo untracked; next-env modified từ trước; không stage |
| 23. Commit | Không tạo: mandatory implementation checks chưa PASS; không push |
| 24. B2C2 readiness | Chưa đạt; không tự triển khai zero confirmation |

Actual Sandbox E2E: **NOT RUN**. Zero-total/Return/Checkout/tunnel/merchant activation/
Refund không được triển khai. Các mandatory tests đều còn pending; không suy ra
exactly-once network calls hoặc financial safety từ việc chỉ đọc source.

Giữ các báo cáo giai đoạn trước, P00/FIX01 và Development Plan nguyên trạng.
Kiểm tra tài liệu: local file links/anchor, Git diff whitespace, file scope và
next-env byte hash; không cài package để kiểm Markdown.

---

## PROTOCOL GATE CONDITIONAL APPROVAL

2026-10-17: người dùng phê duyệt resume bằng **P00 canonical response format +
independent synthetic HMAC-SHA512 vectors**. Blocker report phía trên được giữ
nguyên như lịch sử trước approval; các trạng thái NOT IMPLEMENTED/NOT RUN phía trên
không phải kết quả của lượt resume. Không thay P00/business policy hoặc schema.

Web QueryDr và PDF 2.1.0 ở các link trên được đọc lại. Điểm nối Amount/BankCode trên
web có lỗi trình bày; pipe tại vị trí đó và empty optional segments là giả thuyết
P00 được user phê duyệt cho implementation/testing. Không tự coi là xác nhận từ
provider. Năm demo request đã đối chiếu vẫn không là oracle cho response signing.

### Protocol và independent fixtures

Response canonical giữ chính xác 15 vị trí P00: ResponseId, Command, ResponseCode,
Message, TmnCode, TxnRef, Amount, BankCode, PayDate, TransactionNo, TransactionType,
TransactionStatus, OrderInfo, PromotionCode, PromotionAmount (wire prefix `vnp_`).
Raw UTF-8, dấu `|`, không sort/encode/trim/normalize. Command, PayDate, PromotionCode,
PromotionAmount absent hoặc empty đều giữ segment; mandatory missing/empty bị reject
dù có HMAC hợp lệ. Không thử canonical variants để chấp nhận chữ ký.

[Python reference generator](../backend/test/fixtures/generate-querydr-vectors.py)
dùng duy nhất stdlib `hmac/hashlib/json`, không import application/helpers.
[Static fixtures](../backend/test/fixtures/vnpay-querydr-2.1.0.json) lưu từng raw JSON,
canonical, signedCanonical, expectedHmac và expected result. Mỗi vector có secret
synthetic cố định; không chứa merchant secret thực. Nest verifier khớp expected
digest tĩnh, không tự dùng production signing làm expected oracle. Có request
vector độc lập và đầy đủ các nhóm optional/tampering/invalid syntax/semantics được giao.
Unicode Message/OrderInfo được ký nguyên bytes UTF-8; không lưu/reflect hai nội dung
text đó cho Customer. Reject control/pipe/unpaired-surrogate, không normalize Unicode.
PromotionCode dùng alphanumeric như PDF; promotion fields không thay immutable amount.

Parser chỉ nhận flat JSON object với string scalar, <=16KiB/16 keys; phát hiện
duplicate decoded keys cả `\u` escapes, unknown keys, arrays/objects/null/numbers,
malformed JSON và invalid types. TLS client còn decode UTF-8 fatal. Validate mandatory
fields, HMAC hex128 với timingSafeEqual, merchant/ref/minor amount exact, numeric
transaction identifier<=15 (success nonzero), date/calendar, API/status/type semantics.
Không chia/round callback amount. Không dùng PAY/IPN query-string canonicalization.

### Secure outbound và feature gate

[Transport](../backend/src/payments/vnpay/querydr-transport.ts) injectable, fixed
Sandbox HTTPS transaction URL; native HTTPS verifies TLS, không URL input/Production
fallback/redirect/automatic retry. Absolute timeout5s gồm DNS/connect/body; abort khi
hết hạn, response max16KiB, header max8KiB, chỉ JSON/identity encoding. Phân biệt HTTP,
content-type, timeout, transport, invalid UTF8, invalid JSON và malformed response.
Không log raw signed payload/response/secret; normalized receipt không chứa Message,
OrderInfo, signature, headers hoặc secret.

PaymentModule **luôn wire disabled transport**. Tests override bằng mock transport
hoặc fake HTTPS stream; không có env opt-in để gọi mạng thật. P01-B2A startup gate
tiếp tục chỉ cho phép isolated synthetic configuration; normal mode mặc định MOCK.
Server IP của request builder trong orchestration là loopback cho isolated testing,
chưa phải cấu hình IP merchant live. Native HTTP adapter không tự được kích hoạt.

### Reconciliation, T1/T2 và recovery

POST `/admin/payments/vnpay/attempts/:id/reconcile`: database-backed ADMIN role/JWT,
UUID, strict empty body/query, chỉ direct loopback socket, reject Forwarded và
X-Forwarded-For/Host để tránh tunnel/proxy expose admin controls. Không Customer,
không nhận provider payload/ref/URL/amount từ body. Mỗi invocation chọn đúng một
Attempt, batch bound1, tối đa một outbound request, zero automatic retries/scheduler.
Response private/no-store, Vary Authorization;200 normalized current status,
202 verified UNKNOWN,429 persistent attempt30s gate,503 upstream/technical failure,
409 REVIEW/invalid Order state,401/403/404/400 như auth/DTO contract hiện có.
Review listing endpoint chưa triển khai, không cần cho single-attempt reconciliation.

VERIFIED chưa processed được gọi shared apply trước outbound. Terminal evidence
recover được sẽ không query; lỗi technical T2 giữ receipt để retry recovery nội bộ.
UNKNOWN provisional evidence được thử apply, vẫn giữ resources, rồi cho phép một
inquiry mới theo rate gate. APPLIED trả current status, không query thêm. REVIEW
được giữ, không auto-clear/query/force-paid. Other Order REVIEW hoặc pending verified
evidence chặn inquiry mới. Không suy ra terminal từ local expiry; AWAITING chưa có
IPN và UNKNOWN đủ state PENDING có thể đối soát thủ công.

Shared owner→Order→Attempts→receipts→claim locks và50ms maxWait/400ms transaction,
lock200ms/statement300ms giữ nguyên. Trước network, commit QUERYDR REQUESTED với
requestId random hex32 unique/immutable queryCreateDate và Attempt. PAY TransactionDate
lấy nguyên stored createDate GMT+7; queryCreateDate là now GMT+7. Không network trong DB
transaction. Retry inquiry tạo requestId mới; không tuyên bố exactly-once network.

T1 sau response: strict verify ngoài transaction, rồi lock/revalidate original
Attempt/Order/owner/claim/context bằng engine IPN, transition REQUESTED→VERIFIED
với normalized payload/hash. Deduplicate same attempt/source/hash; duplicate inquiry
được finalize UNRESOLVED/DUPLICATE_RESPONSE, reuse existing receipt. HTTP/signature/
provider errors → sanitized UNRESOLVED; crash có thể để REQUESTED. Receipt immutability,
unique requestId/payloadHash và journal guards dùng nguyên13 migrations/FIX01.

T2 gọi lại **IpnService.apply**, không financial engine thứ hai. Đổi classification
theo evidence có transactionType (source QUERYDR được kiểm tra nhất quán); QueryDr
00/type01/status02 là FAILED dù IPN00/status02 vẫn REVIEW. Compatible terminal
IPN/QueryDr so sánh financial meaning/bindings/status/transaction number, không
so inquiry responseCode với IPN decline code. Hai IPN vẫn giữ strict comparison cũ.
APPLIED Payment/selected provider fields không bị overwrite bởi late evidence.
T2 atomic Payment/Order/stock/Loyalty/Award/Cart effects và lock ordering giữ nguyên.

QUERYDR00/type01/status00→SUCCEEDED;00/type01/status02→FAILED;
00/type01/status01→UNKNOWN, giữ reservations. Nonterminal fraud/reversal/refund/
unsupported types/statuses→durable REVIEW. API91/94/97/99, not found, unsigned,
malformed, timeout/network errors không tạo financial evidence hoặc release/fail
Order. Non00 API responses được validate signature/structure trước khi chuyển
inquiry UNRESOLVED; response thiếu required data vẫn fail closed như malformed.
Mâu thuẫn IPN/QueryDr, old failed Attempt nhận success, reused transaction number
hoặc REVIEW phát sinh trong network wait đều giữ REVIEW/evidence và original money.
Không tự refund, retry payment hoặc sửa journal.

### External verification và giai đoạn tiếp theo

**INDEPENDENT SYNTHETIC CRYPTO TEST PASS** là kết quả kiểm chứng offline.
**EXTERNAL SANDBOX RESPONSE VERIFICATION PENDING**. Không có actual Sandbox E2E.
Trước activation cần actual signed response có optional representative hoặc xác
nhận kỹ thuật rõ ràng từ VNPAY về optional canonicalization; provider rate/minimum,
merchant/server IP/credentials/callback/TLS cũng phải được kiểm tra trong task được
duyệt riêng. Nếu thực tế mâu thuẫn P00, STOP, không tự đổi signing policy.
B2C2 zero confirmation, Return, Checkout, ngrok và Refund chưa triển khai.

### P01-B2C1 QUERYDR RECONCILIATION RESULT — lượt resume

**P01-B2C1 IMPLEMENTATION COMPLETE — EXTERNAL SANDBOX VERIFICATION PENDING**.

| Mục | Kết quả đã kiểm chứng |
| --- | --- |
| 1. Git baseline | `f62445b8ece0dd777843b97b7aec5308a8b7694b`, khớp expected |
| 2. Protocol gate | Conditional approval của user được ghi phía trên; original blocker giữ nguyên |
| 3. Canonical response | 15 trường/pipe/raw UTF-8/empty optional; mandatory empty bị reject |
| 4. Independent HMAC | Python stdlib oracle/static expected canonical/digest;72 protocol tests PASS |
| 5. Optional fields | Từng field thiếu, tất cả thiếu, empty, Unicode; wrong-order/dropped-segment/tampering/malformed/duplicate/unknown/type cases PASS |
| 6. Request signing | Independent request fixture PASS; original PAY date GMT+7, query now, unique hex32 IDs |
| 7. Response verification | Strict JSON + timing-safe HMAC + binding + transaction semantics; fail closed |
| 8. Transport |14 fake-HTTPS tests PASS; fixed endpoint/TLS/5s/16KiB/no redirect; default disabled |
| 9. Eligibility | ADMIN DB role/direct loopback/empty DTO/one Attempt/rate gate;6 access/gate unit tests + PostgreSQL HTTP cases PASS |
| 10. T1/T2 | Durable REQUESTED/QUERYDR VERIFIED, normalized dedupe, shared IPN apply/recovery; crash cases PASS |
| 11. IPN/QueryDr race | Compatible success/failure, contradictory outcomes, in-flight old Attempt/new retry, duplicate number cases PASS |
| 12. UNKNOWN/REVIEW | UNKNOWN hold/later resolution; REVIEW trước/trong inquiry sticky; no auto-release/force-paid |
| 13. Financial idempotency | Payment/Award/SETTLE/RELEASE/stock/Cart exactly-once effects under retries/crashes; FIX01 cycle2 PASS; no exactly-once network claim |
| 14. Mock compatibility | All baseline unit535/PostgreSQL587 test names retained and PASS; financial/Loyalty/Inventory/Mock suites included |
| 15. Backend tests |21 suites/627 tests PASS: original535 +92 new (72 protocol/14 transport/6 access) |
| 16. PostgreSQL |23 suites/635 tests PASS: original587 +48 QueryDr integration/HTTP cases; isolated local cloned database/UUID schemas, no development fixture writes |
| 17. Frontend |191 tests PASS; lint/typecheck/build PASS; production build from source copy |
| 18. Database fingerprints | Before/after READ ONLY19 fingerprints/catalog/full13 migration ledger/checksums/functions/sequences match; Prisma validate/status/diff PASS/no drift |
| 19. External compatibility | EXTERNAL SANDBOX RESPONSE VERIFICATION PENDING; actual Sandbox E2E NOT RUN |
| 20. Remaining blockers | No synthetic implementation blocker; live activation prerequisites remain as documented |
| 21. Git status | Scope19 files:12 backend,6 Docs,README; unrelated next-env remains modified/byte-exact/excluded; no schema/package/frontend code changes |
| 22. Local commit | Authorized after mandatory checks/review PASS; SHA reported in final response/Git history, not self-embedded in this commit |
| 23. B2C2 readiness | Ready for a separately assigned internal zero-total task; not implemented here |

Machine-readable evidence (evidence kiểm thử cũ đã dọn) records source hashes,
check exit statuses, test counts and baseline-name preservation. Both backend and
frontend lint/typecheck/build PASS; Prisma status reports13 applied migrations and
diff reports no difference. READ ONLY development proof also checks functions and
sequences against preserved FIX01 state. Scoped local-secret/private-key scan,
local file links, Git diff whitespace/scope and exact next-env SHA256 PASS.
No baseline tests removed/skipped. Expected negative-path503 logs and existing pg
concurrent-query deprecation notices do not represent failed assertions.

Changed backend: `querydr-protocol.ts`, `querydr-transport.ts`, QueryDr service/
controller, existing PaymentModule/IpnService integration; three unit suites, one
PostgreSQL suite, Python oracle/static JSON. Changed docs: this preserved report,
evidence, API design, Decisions, Development Plan, Traceability Matrix and README.
No push/deploy/actual gateway calls, automatic B2C2, Return, Checkout or tunnel work.
