# BrewLite — Quyết định thiết kế

## Checkout expiry, independent Cart, persistent auth — ACCEPTED USER / TECHNICAL (2026-10-22)

Người dùng giao triển khai deadline10 phút, Cart độc lập và persistent auth cho3 roles. [Contract cập nhật](CHECKOUT_SESSION_UPDATE.md) supersede D19/B07 memory-only session, D31/B10 khóa Cart và clear Cart khi Payment success, cùng P00 TTL900s. Snapshot và lấy các CartItem hiện tại diễn ra atomically ở create Order; settlement không chạm Cart mới. PostgreSQL lưu deadline, worker catch-up sau restart, không force FAILED/CANCELLED UNKNOWN. VNPAY expiry GMT+7 và verified-IPN/QueryDr OFF giữ nguyên. Quyết định kỹ thuật: JWT3600s memory + opaque HttpOnly rotating session absolute7 ngày, hash DB, sid revocation, same-origin Next auth proxy + exact Origin/custom CSRF header. Migration additive, không đổi PDF hoặc cập nhật dữ liệu tài chính lịch sử.

## VNPAY Sandbox + Neon — ACCEPTED USER / TECHNICAL (2026-10-21)

Owner giao mở VNPAY Sandbox development với database Neon dùng chung trên `sang`. Thay giới hạn hostname-local bằng local **hoặc** pooled Neon `.neon.tech`, database `brewlite_dev`, TLS require/verify-full. Production và synthetic-test gate giữ nguyên; Prisma CLI tiếp tục direct `DIRECT_URL`. Merchant dùng một callback HTTPS đã đăng ký và một backend owner; member không chạy ngrok riêng. Chọn vai trò qua private `BREWLITE_CALLBACK_ROLE` khi dùng Neon, không có stage/Gate/session/Attempt quota.

Đo 20 SELECT tuần tự trên Neon: 626 ms, nên deadline local 400 ms không phù hợp remote I/O. Order/payment/Attempt/IPN/zero/Return trên Neon dùng bounded maxWait 2000 ms, transaction timeout 5000 ms; local giữ 50/400 ms. SQL lock timeout 200 ms, statement timeout 300 ms, UTC và mọi lock order/idempotency/OCC/constraint/rollback/receipt/UNKNOWN/REVIEW giữ nguyên; không auto retry hoặc network gateway trong transaction. Đây là điều chỉnh kỹ thuật cho latency, không thay money/state contract hay tuyên bố NFR01 đạt trên Neon. Không đổi schema/migrations, không seed/restore hoặc test-write lên Neon. [Bằng chứng và thao tác](VNPAY_NEON.md).

## Neon development dùng chung — ACCEPTED USER (2026-10-21)

Owner giao chuyển nguyên database local `brewlite_dev` sang Neon PostgreSQL 18 trên branch `sang`. Backend giữ PrismaPg với pooled `DATABASE_URL`; Prisma 7 CLI dùng direct `DIRECT_URL` theo [Prisma connection documentation](https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections). Launcher MOCK cho phép Neon có TLS. VNPAY Sandbox giữ guard database local; không đổi financial contract, schema, migrations hoặc business logic. Local giữ nguyên làm dự phòng. Không seed/migrate lại database đã restore; thành viên nhận credentials qua kênh riêng. [Kết quả và cách dùng](NEON_DEVELOPMENT.md).

Giữ ID để truy vết quyết định người dùng và quyết định kỹ thuật. Các D29/D30 có nhãn theo checkpoint (B04/B07 và B08/B09); dùng cả tên/nhãn để phân biệt. Không xem ACCEPTED design là bằng chứng test/implementation.

Thứ tự đọc hiện hành: D35/D40 mở rộng role/operator; D43/D44 thêm redemption/journal; D46 hủy A07; P00 + attribution amendment + minimum/admission bên dưới mở rộng gateway; Normal launcher thay cơ chế one-attempt/30 phút cho vận hành local. PDF và state graph không đổi.

## Payment decisions hiện hành

| Quyết định | Nội dung / nguồn |
| --- | --- |
| P00 D01–D08 | VNPAY Sandbox optional, verified IPN settlement, Return read-only, UNKNOWN/REVIEW protection; [frozen contract](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md) |
| Attribution amendment | RESERVE gắn intended Attempt trong transaction, không sửa journal cũ; [chi tiết](P01B2A_LOYALTY_ATTRIBUTION_AMENDMENT.md) |
| D3-01 | Min 5.000 VND cho positive final VNPAY total, sau promotion/points; zero explicit internal flow |
| D3-02 | DRAIN_ONLY giữ profile/callback/status/replay, chặn new positive Order/Attempt; không đổi settlement |
| Browser Return / Cancel UX | Read-only 303; status DTO chỉ map CUSTOMER_CANCELLED từ persisted verified/applied evidence; không tin query browser |
| Normal Sandbox | Admission theo provider/config/health/drain; không quota Attempt/thời gian ứng dụng; external QueryDr OFF |

## D46 — A07 rollback (ACCEPTED USER / TECHNICAL, 2026-10-15)

D45 Campaign extension cancelled by explicit user approval. Restore functional L01
checkpoint84349f41; retain original applied20261014230000_promotion_campaign SQL and
ledger, append20261015000000_compensate_a07_to_l01. No business-row deletion, reset,
history rewrite or database restore. Approved compensation guard rejects nonempty
Campaign/membership/version. Original backup/dry-run evidence retained separately
from actual apply evidence; all required gates must pass before local commit.

## D44 — L01 technical implementation (ACCEPTED TECHNICAL, 2026-10-14)

D43 frozen business/schema/API policies implemented without a new business choice.
[L01 evidence](L01_LOYALTY_REDEMPTION_IMPLEMENTATION.md): exact owner-locked journal
proof, final-counter refund/reverse write, SQL NUMERIC signed checks, existing claim
operations and current state/version OCC. Read-only snapshot-bounded encrypted cursor
matches approved L00. Adapter Date/TIMESTAMPTZ session mismatch fixed with consistent
UTC options; preserve scoped search_path on the same URL. No global PG/Git config
change or timestamp backfill. Journal-aware tests retain immutable fixtures until
owned UUID schema drop; never disable guard/delete history in public. Legacy original
award fixtures constructed before opening rather than rewriting journal EARN.
Migration verified isolated then development; all old columns/migration rows preserved,
4 actual openings, debt0, reconciliation0 mismatches. No policy/schema expansion.
A07/B17 remain PLANNED; external QA/NFR boundaries recorded, no full DoD inference.

## D43 — L00 direct Loyalty redemption (USER APPROVED, 2026-10-14)

L00-Z01 OPTION B, L00-D01 OPTION A, L00-S01 OPTION B, L00-A01 OPTION B are explicitly
USER APPROVED. [Frozen contract](L00_LOYALTY_REDEMPTION_CONTRACT.md) is documentation
only, not implementation.100 VND/point; Order-level after one Promotion; earned
floor(finalTotal/10000); finalTotal0 uses ordinary explicit Mock SUCCESS/FAILURE,
no automatic PAID/cash refund. Separate nonnegative BIGINT debt, credits offset first,
point reserve/reacquire/settle blocked while debt>0. Four Order fields/two enums/one
append-only journal with source/cycle attribution; CUSTOMER-only bounded history,
additive DTOs/balance/preview and legacy hash/replay compatibility.

Paid A reversal during reserved B leaves B intact and gates Payment before mock or
any committed Payment/effect. Existing owner unpaid cancellation releases B points
to debt, restores stock and unlocks D31; remainder permits new r0 cash Order. No new
cancellation edge, repricing or forgiveness. B16 still reverses exact stored award
once and refunds exact redeemed points, preserves Payment/paidAt/snapshots. Accounting
uses opening+journal+held reconciliation (§10/17), replacing award-only equality
only after L01 cutover. Unexplained corruption remains invariant503.

D43 supersedes only the no-redemption/no-journal/no-preview/no-cursor scope clauses
of D28/D30/D32/D34 and historical design notes for this extension. D31, D42/A06
namespaces, PDF/FR baseline, graph, stock OCC and historical claim bodies stay intact.
Constraints/index/guard/opaque owner-bound cursor in §§17–20 are technical completion
within selected options, not unapproved business additions. No extra stored component.
Old financial data retained via defaults and actual OPENING, no synthetic history.
L00 design blockers0; L01 tests/implementation/migration outstanding and require
separate assignment. L00 CONTRACT FROZEN; no automatic L01/A07/B17.

## D42 — A06 inventory idempotency migration approval (ACCEPTED USER, 2026-10-13)

User explicitly approves both append-only migrations: IdempotencyOperation adds
ADJUST_INVENTORY without removing prior values, and idempotency_result_check becomes
operation-aware. COMPLETED inventory requires order_id=NULL; CREATE_ORDER/PAY_ORDER
still require a valid Order via existing NOT NULL branch and retained FK. PROCESSING,
response completion fields, response status bounds, unique scope and all other
constraints remain unchanged. No ledger/new table/independent idempotency subsystem.
Enum addition commits before the CHECK migration uses it. Isolated PostgreSQL
migration/legacy-row/FK/CHECK verification must pass before development deployment.
No applied migration edits/reset/data deletion. [A06](A06_INVENTORY_MANAGEMENT_CONTRACT.md)
records implementation/evidence separately from this approval. A07/B17 remain PLANNED.

A06 verification extends D33's existing single-worker recycling to the default
Jest HTTP/unit suite after `--runInBand` terminated natively with3221226505.
The same14 suites passed342 tests with isolated workers; no concurrency assertions
were removed and no business retry was added. Root cause remains unconfirmed.
Unknown idempotent-adjustment contention preserves original key/body and returns
409 IDEMPOTENCY_IN_PROGRESS after one replay recovery read; stale version/CAS
business rejection remains409 CONCURRENT_UPDATE. This avoids treating an unresolved
duplicate as permission to issue a new-key delta.

## D41 — A05 Topping OCC approval (ACCEPTED USER, 2026-10-13)

User explicitly approves Topping.version Int default0/NOT NULL/CHECK>=0 together with AD02 ProductSize.isActive and Topping.isActive default/backfill true. This clarifies A00/D36 and supersedes only the earlier A05 prompt's “Do NOT automatically add Topping.version” restriction. Existing rows/history/IDs preserved; no applied-migration rewrite/reset. Topping PATCH/DELETE require original expectedVersion; same-transaction lock/CAS, missing404, stale409 CONCURRENT_UPDATE, reference409 RESOURCE_IN_USE. Successful PATCH increments once and returns current AdminTopping.version; no automatic retry/expectedVersion replacement, no public version field or bump of every Product.version.

ProductSize/ProductTopping mutations use parent Product.version, no child version or association lifecycle flag. Global lifecycle/name/price affects future configurations; B09 read-time pricing/B10–B11 snapshots/Payment retry/B16 preserved. [A05](A05_SIZE_TOPPING_MANAGEMENT_CONTRACT.md). A06/A07/B17 remain PLANNED.

## D40 — UI01 STAFF read scope and distinct role experiences (ACCEPTED USER, 2026-10-13)

User explicitly approves [UI01](UI01_ROLE_BASED_INTERFACE_CONTRACT.md), including backend authorization change after A04. STAFF default operator list only PAID/PREPARING/READY; exact filter also permits COMPLETED, forbidden PENDING/PAYMENT_FAILED/CANCELLED403 FORBIDDEN. STAFF detail only four readable states; hidden/missing404 ORDER_NOT_FOUND. ADMIN retains all seven states. This intentionally supersedes A02/A00 all-status STAFF reads, without deleting historical decisions/evidence. Sorting/DTO/no-store/snapshots/customer ownership/B16/A03 unchanged; DB role remains authoritative each request.

Shared existing login, separate customer/staff/admin layouts; CUSTOMER default `/`, STAFF `/operator/orders`, ADMIN `/admin` with actual order counts/navigation. Compatible safe deep links preserved. Completed history `/operator/orders/completed`, Admin Orders `/admin/orders` and `/admin/orders/[id]` use existing operator GETs. D38 ADMIN default redirect superseded only here. A04 UI refined without schema/DTO/lifecycle change; A05–A07/B17 PLANNED, no revenue reporting/customer management/persistence/polling/PDF change.

## D39 — A04 phased DTO and legacy Product readiness (ACCEPTED USER, 2026-10-13)

Người dùng phê duyệt hai clarification trước coding, [A04 contract](A04_ADMIN_PRODUCT_MANAGEMENT_CONTRACT.md). A04 AdminProduct sizes chỉ `{size,extraPrice}`, toppings chỉ `{id,name,price,createdAt,updatedAt}`, monetary values giữ Decimal/VND strings; không ProductSize.isActive/Topping.isActive/Topping.version trong A04. Product.isActive thuộc AD01/A04. A05 option flags đã thuộc phase riêng; Topping.version chỉ triển khai khi task/contract A05 tương ứng được giao, không inferred từ approval A04.

Public availability xét đồng thời Product.isActive, stock>0 và ít nhất một size S/M/L hợp lệ. Inactive list hidden/detail404 NOT_FOUND theo AD01; active zero-size vẫn visible nhưng unavailable. Existing Cold brew giữ record/price/stock/options, migration backfill active=true, không default size/repair/delete. Create mới vẫn bắt buộc1..3 distinct valid sizes, stock0 server-owned. Backend checkout đọc PostgreSQL, invalid size dùng INVALID_ITEM_OPTIONS, inactive PRODUCT_UNAVAILABLE; Cart retained/warning/remove, Order snapshots/Payment retry B11/Loyalty/Promotion history giữ nguyên. Không thay stock/OCC rules, không A05–A07/B17/redesign.

## D38 — A01 implementation boundary và minimal shells (ACCEPTED USER TASK, 2026-10-11)

User explicitly giao development A01 authentication/RBAC/create-only provisioning và minimal operator frontend shell. A00 approved route `/operator/orders` được tạo shell STAFF/ADMIN, `/admin/products` tạo shell ADMIN-only; login default CUSTOMER `/`, operators `/operator/orders`, compatible safe returnTo preserved. Đây là foundation của A01 theo user task §5/6, không A02 Order UI/A04 Product CRUD hoặc fake dashboard. A02–A07 business APIs/UI/remaining schema PLANNED; AD01/AD02 A04/A05 không implement A01.

[A01 contract/evidence](A01_RBAC_AUTH_CONTRACT.md): UserRole/default/backfill CUSTOMER migration append-only test-before-development; JWT sub/iat/exp/HS2563600s giữ; DB role public projection/guard mỗi request, explicit CUSTOMER private controllers, no privilege inheritance/impersonation. RolesGuard rejects missing/unknown metadata; future operator/admin ACL tested in isolated controllers/loopback verification-only process, never production AppModule. CLI standalone existing pg/bcrypt, manual opt-in local development, interactive/hidden password/create-only, no seed/startup/account promotion.

UI/cache logout/expiry/role switch clears, same-owner uncertain checkout/payment transport context giữ B10/B11 recovery without JWT; other owner discarded on sign-in. Frontend role hint có thể stale tới re-login khi DB thay ngoài app, backend quyền next request vẫn từ DB; không me/role/refresh/revocation subsystem. No new dependency/version/lockfile/infra/business-engine change. Automated regression/security/browser PASS như A01 contract không đồng nghĩa human QA/full DoD/B17.

## D37 — A00 AD01/AD02 catalog lifecycle (ACCEPTED USER / APPROVED, 2026-10-11)

Người dùng xác nhận sau checkpoint `d75457db771678d300452c35e1ecaf67d3ea142b`: **AD01 APPROVED / AD02 APPROVED**. [A00 contract §8/9/16](A00_ADMIN_STAFF_CONTRACT.md) đã đóng hai lựa chọn; trạng thái NEEDS DECISIONS ở checkpoint cũ giữ trong Git history và được superseded. **ADMIN CONTRACT READY**, A01 đủ role/migration/auth-response/RolesGuard/provisioning/permission/security-test contract; chưa triển khai trong task documentation này.

- **AD01 — A04 PLANNED:** `Product.isActive Boolean @default(true)`. true+stock>0 được đặt khi điều kiện khác hợp lệ; true+stock0 hết hàng; false ngừng kinh doanh, không Order mới. Không dùng stock0 để ngừng bán; toggle không đổi stock. Giữ Cart/history/Order snapshot/Payment retry, không reprice. Existing Product active.
- **AD02 — A05 PLANNED:** `ProductSize.isActive Boolean @default(true)` theo product-size; `Topping.isActive Boolean @default(true)` toàn hệ thống. Existing ProductSize/Topping active. Checkout mới validate DB trạng thái hiện tại; Cart có option không hợp lệ giữ dòng và thông báo để người dùng điều chỉnh, không tự xóa. Order snapshot/Payment retry/history giữ nguyên. ProductTopping per-product lifecycle limitation chỉ ghi issue; không tự thêm field/migration.
- Lifecycle migrations/implementation **chỉ A04/A05, không A00/A01**. Additive migrations mới, NOT NULL/default/backfill true; không xóa/reset PostgreSQL, không thay Order/Payment/Loyalty history hoặc sửa migration đã apply. Không acceptance runtime claim từ design approval.

Remaining A00/A01 open decisions:0. A08/A09 chưa duyệt và không chặn scope này. D35/D36 và Q02/D06/D14/D23 supersede giới hạn scope extension giữ nguyên; D37 chỉ đóng lifecycle approvals, không đổi PDF/graph/công thức/security B07.

## D35 — A00 Admin/Staff extension (ACCEPTED USER, 2026-10-11)

Người dùng phê duyệt **USER-APPROVED EXTENSION A00–A07**: contract/design; RBAC/auth/provisioning; operator Order UI; workflow/Admin PAID cancellation; Product; Size/Topping; Product-stock Inventory; FIXED AMOUNT Promotion management. A08 Customer Management/A09 Reporting chưa được duyệt. Không sửa PDF hoặc FR/NFR/BR gốc. [A00 contract](A00_ADMIN_STAFF_CONTRACT.md) là nguồn contract mới; mọi API/route/schema/CLI mới **PLANNED, NOT IMPLEMENTED**. A00 chỉ tài liệu; A01/B17/full UI redesign chưa được giao triển khai.

Ba role CUSTOMER/STAFF/ADMIN. User.role enum/default/backfill CUSTOMER được duyệt cho A01; public register luôn CUSTOMER/reject role; backend role đọc DB mỗi request, JWT giữ B07. STAFF/ADMIN đọc operator Orders và PAID→PREPARING→READY→COMPLETED; chỉ ADMIN PAID→CANCELLED theo B16. ADMIN quản lý Product/Size/Topping/Inventory/Promotion; không operator unpaid cancel, direct Order total/Payment/Loyalty edits, customer-account CRUD hay revenue reports. Customer chức năng/ownership hiện tại giữ nguyên, không internal transitions.

D35 **thay giới hạn phạm vi Q02/D06/D14/D23/DECISIONS §5 và DESIGN_REVIEW DR04 đối với extension đã duyệt**. Những đoạn cũ dưới đây/B07/B16 contract là lịch sử baseline và evidence lúc implement, không bị xóa hoặc coi là operator implementation. No-public-staff/API/UI restriction vẫn đúng cho baseline PDF/B16 cũ; operator authorized interfaces được PLANNED tại A00. Q03/D24/DR14/DR15 vẫn giữ: Customer chỉ hủy unpaid, B16 paid-cancel hoàn snapshot qty/thu hồi đúng award atomically, giữ Payment success/paidAt, không refund. Không đổi graph/công thức hoặc viết lại B05/B07/B09/B10/B11/B13/B15/B16 engines đã PASS.

Product CRU/safe delete no-reference/FK Restrict; không cascade Cart/history, không price-recompute snapshot. Stock0 khác ngừng kinh doanh. Lifecycle flags Product/Size/Topping **APPROVED** theo AD01/AD02/D37; schema/application PLANNED A04/A05, không A01 role migration. Inventory ADMIN-only/delta/OCC/nonnegative/lost-response replay; không ledger. Promotion một fixed code/Order, config active/date/minimum, snapshot/retry/history preserved. Provisioning manual create-only development/demo CLI, hash B07/no hardcoded credentials/no seed/startup/public operator registration.

## D36 — A00 operator contracts và concurrency (TECHNICAL DESIGN, PLANNED, 2026-10-11)

- `/operator/orders` read/transition namespace STAFF+ADMIN; `/admin/*` ADMIN-only. Backend deny-by-default, authenticated wrong-role403 FORBIDDEN trước resource lookup/replay; customer paths giữ ownership và CUSTOMER permission. Auth response user thêm DB role ở A01, token vẫn sub/iat/exp/memory/HS2563600s.
- B15 current snapshot projection dùng chung, operator thêm version/updatedAt chỉ ở authorized reads; không owner PII. A03 wrapper gọi B16 transitionOrder bằng expectedVersion gốc, không tự ghi status/stock/award. B16 action response giữ detail không version; frontend GET operator detail sau action để có coherent current status/version. Lost response không tự advance bước tiếp; paid-cancel repeated no-op giữ B16.
- Product/Size/ProductTopping dùng existing Product.version; Topping.version default/check0 PLANNED A05; Promotion.version default/check0 PLANNED A07. Admin mutations OCC/atomic timestamps/bounds, không automatic transaction retry. Product tạo stock0/version0, topup chỉ A06. S/M/L only; option/history/Cart references guard safe delete, không cascade. Promotion code immutable, referenced rows disable/update được nhưng delete409 RESOURCE_IN_USE.
- A06 đề xuất reuse IdempotencyRequest + ADJUST_INVENTORY namespace, hash productId/delta/expectedVersion, exact committed result replay sau authorization/trước current business validation. Cần enum migration và operation-aware idempotency_result_check cho inventory COMPLETED.order_id=NULL, hai operation gốc vẫn NOT NULL; không ledger/new table. Enum ADD VALUE commit trước CHECK dùng enum mới. Claim/stock/version/response cùng transaction; unknown response cùng key/payload, known rollback conflict GET+xác nhận thao tác mới, không auto double delta.
- Checkout Promotion concurrency giữ eligibility/snapshot ở B09 transaction read; admin edit sau read không retroactively revoke/reprice Order snapshot. FK race delete-vs-create phải sanitized rollback; Payment retry/replay luôn snapshot B11/B13.

Đây là contract kỹ thuật thuộc extension đã duyệt, không thay policy PDF. [DTO/API/tests/dependencies](A00_ADMIN_STAFF_CONTRACT.md). AD01 Product.isActive và AD02 ProductSize/Topping.isActive đã **APPROVED / ACCEPTED USER** theo D37; áp schema/application chỉ tại A04/A05 khi được giao development, không A00/A01. Baseline Q01–Q19/DR14/DR15 closure giữ nguyên; lifecycle extension nay cũng closed về quyết định.

## D34 — B14 current Loyalty balance (ACCEPTED USER, 2026-10-09)

User explicitly approves one API contract extension: GET /loyalty, JWT required, HTTP200 `{ "loyaltyPoints": 9 }`, reading current users.loyalty_points directly from PostgreSQL. Identity comes only from JWT; no client userId/points, no writes, no recalculation from Orders/current catalog. Zero balance returns0. Unauthorized401 follows existing conventions. Response uses private/no-store caching and frontend fetch no-store.

This is a bounded exception to D32's prohibition on inferred new Loyalty endpoints. B14 includes /loyalty UI/navigation with fresh reads on entry/Retry, loading/zero/error/Retry, responsive/keyboard support and session isolation; login response balance is not authoritative after Payment. No other Loyalty endpoint, history/adjustment API, tier/redemption/expiration, schema or award-rule change is authorized. GET /orders/me and Order history remain B15; internal exact award reversal/atomic stock restoration remain B16. B11's Decimal floor(Order.total/10000), PAID unique/order award and atomic balance increment are reused unchanged. PDF requirements are unchanged. [B14 contract](B14_LOYALTY_CONTRACT.md).

## D33 — B12 PostgreSQL test process isolation (technical, 2026-10-08)

B12 reproduced Windows Node24.15 native exit3221226505 with multiple Prisma/PostgreSQL Jest suites sharing a process. Payment suite alone passed43/43; a sequential child worker recycled between suites passed170/170 across7 suites. No useful Windows application crash event metadata was returned; native root cause remains unproven. Default database test script now uses Jest maxWorkers1 + workerIdleMemoryLimit1MB to recycle the child after each suite instead of runInBand; concurrency inside each suite is unchanged. This is a test-runner mitigation, no dependency/runtime/schema/business contract change and no test disabled. Verify default command and report observed outcomes; do not claim the upstream native issue fixed. Frontend acceptance remains baseline B12 (FR07–09/13, API section8), no new endpoint or B13/B14 implementation.

## D32 — B11 atomic Loyalty award (ACCEPTED USER, 2026-10-08)

User explicitly moves minimal PAID award from B14 into B11: Payment SUCCEEDED, Order PAID/paidAt, floor(Order.total/10000) LoyaltyAward unique/order (including zero), atomic user balance increment and purchased Cart clearing commit in one transaction; any failure rolls back all. FAILED/replay/concurrent requests/cancellation never award again. This phase change prevents PAID/payment/award/balance/Cart inconsistency; original PDF requirements and formula remain unchanged. B14 retains balance/history/UI work only to the extent already supported by baseline (no new loyalty endpoints, redemption or expiration inferred). Internal paid-cancel inventory restoration and exact award reversal remain later internal order workflow B16; no refund or public paid-cancel in B11. B11 includes payment retry and minimal checkout interaction explicitly assigned by user, without marking full B12/B14/B16 done.

Ngày 2026-10-06. Q03/Q04/Q10/Q11 và DR14/DR15 đã đóng; **FINAL DESIGN REVIEW: READY FOR DEVELOPMENT**. Snapshot design closure bên dưới giữ baseline business. Cập nhật implementation: B03 bootstrap/checkpoint `56d70b7`, B04 database foundation đã PASS theo audit; D29 ghi mapping kỹ thuật, không authentication/business API/service mới.

Nguồn: [PDF BrewLite VER 1.0](BrewLite-CongNghePhanMem.pdf), đã đọc lại đủ 8 trang. SHA-256 kiểm tra ngày 2026-10-06: `08EFC9A6CC247123500419F01160C76712EC773AFFC998D2193F2873EF5312CC`. Các quyết định kỹ thuật dưới đây đã ghi trong lượt closure trước; lượt hiện tại xác nhận DR14/DR15, giữ đúng baseline PDF và ghi lựa chọn schema nhỏ phục vụ rollback.

## 1. Phân loại Q01–Q19

A = REQUIREMENT DECISION; B = TECHNICAL DECISION; C = OUT OF SCOPE / OVER-ENGINEERING. Question gốc thường gộp nhiều ý: Reason và Impact chỉ rõ phần giữ/bỏ, không dùng C để loại requirement bắt buộc.

| Question | Category | Reason | Current Decision | Impact |
| --- | --- | --- | --- | --- |
| Q01 — Nguồn PDF | B | Một PDF BrewLite VER 1.0 hiện có; tên khác không phải mâu thuẫn nội dung | RESOLVED: dùng đúng file thực tế, ghi SHA-256; không đổi tên/sửa PDF | Bỏ blocker xác nhận lại tên file |
| Q02 — Actor pha chế/hủy | C | §3.2 loại UI barista khỏi MVP; §9 yêu cầu backend graph/test, không operator API | SCOPED: pha chế/PAID cancel qua service nội bộ + tests; không staff role/UI/public status API. Customer chỉ hủy unpaid của mình | Giữ đủ graph; paid-cancel hoàn tồn/thu hồi điểm theo DR14/DR15 đã đóng; cancel unpaid là API hỗ trợ nhánh có trong PDF |
| Q03 — Hủy PAID | A | PDF có cạnh PAID → CANCELLED, quyền customer không đồng nghĩa domain graph | ACCEPTED USER: Customer chỉ hủy unpaid workflow hiện tại; không hủy PAID/COMPLETED; không refund/payment reversal | Không CONFIRMED mới; internal paid-cancel vẫn giữ graph, hoàn tồn/thu hồi điểm cùng transaction; payment success/paid_at giữ lịch sử, không refund |
| Q04 — Giá size/topping | A | Người dùng chốt công thức, seed không business rule cố định | ACCEPTED USER: itemPrice = baseProductPrice + sizeExtraPrice + sum(toppingPrice); mọi giá lấy DB, money DECIMAL | Size.extra_price/topping.price và snapshot; không hard-code phụ thu |
| Q05 — Cart/badge | User decision B08 | Task 5 state/qty/badge; persistence cũ thay bởi PostgreSQL theo user | ACCEPTED USER B08: PostgreSQL Cart/CartItem của JWT user; Zustand chỉ UI/cache; badge tổng qty, gộp product+size+topping set chuẩn hóa; edit add-new rồi remove-old | Q05 cũ SUPERSEDED bởi user decision 2026-10-07; bốn Cart endpoints; tập option theo Q04 |
| Q06 — Login/sửa giỏ/resume | B | Orchestration kỹ thuật để giữ giỏ/không lặp đơn | RESOLVED: login quay lại checkout; snapshot bất biến; hủy unpaid đang gắn trước khi sửa giỏ/tạo đơn mới; giữ key/payload/orderId theo user trong tab | Không API sửa order; lỗi mạng dùng key cũ, không tự tạo đơn mới |
| Q07 — Idempotency boundary | B | §9/12 bắt payment idempotent; Task 6 tách create order | RESOLVED: cùng helper/bảng cho Idempotency-Key ở cả POST /orders và /payments; scope user+operation+key; payment không tạo order | Bao phủ duplicate checkout lẫn payment; không distributed lock/retry engine |
| Q08 — Tồn | B | §9 cho phép theo sản phẩm; §12.2 có Product.stock | RESOLVED: 1 ly trừ 1 đơn vị product, dùng chung các size; không stock topping/ingredient | Không Ingredient/Recipe/warehouse |
| Q09 — Trừ/nhả tồn | B | PDF yêu cầu transaction + OCC, không TTL reservation | RESOLVED: trừ trực tiếp khi PENDING; hoàn khi failed/cancel unpaid; retry failed trừ lại; PAID không trừ lần hai; không inventory_state/TTL/job | PENDING bỏ dở giữ tồn tới xử lý/hủy: giới hạn demo công khai, không hứa giải phóng khi đóng browser |
| Q10 — Promotion | A | PDF không bắt percentage; người dùng giới hạn fixed amount | ACCEPTED USER: finalAmount = max(0, orderTotal - discountAmount), chỉ FIXED AMOUNT | Discount DB, orders lưu giảm thực tế; không percentage/quota |
| Q11 — Loyalty | A | Người dùng chốt tỷ lệ và không cộng cho đơn hủy | ACCEPTED USER: earnedPoints = floor(finalAmount / 10000), integer; cộng tại PAID, internal paid-cancel thu hồi đúng points; COMPLETED không cộng lại | Cộng một lần tại PAID; internal paid-cancel thu hồi đúng points của order, COMPLETED không cộng lại |
| Q12 — Auth | B | JWT/bcrypt/guard có sẵn trong đề; policy kỹ thuật nhỏ | RESOLVED: bcrypt cost 10, password 8–72 byte UTF-8, JWT HS256 1 giờ trong memory, email trim/lowercase; register rồi login | Reload login lại; không refresh/session DB/reset/social login |
| Q13 — API <500 ms | B | §4.2 nêu rõ ngưỡng, không được loại thành production SLA ngoài scope | RESOLVED: protocol local ở §4, mọi mẫu <500 ms, ghi max/môi trường; không thay p95 | Đóng câu hỏi phương pháp, chưa tuyên bố đạt |
| Q14 — Browser | B | PDF không nêu ma trận cụ thể | RESOLVED: Chrome/Edge và Firefox stable lúc B18; ghi version, viewport 390×844/1366×768 | Không mobile native/browser grid/WebKit riêng |
| Q15 — Mock | B | §6 cho mock, không cần provider thật | RESOLVED: server mode SUCCESS/FAILURE; tests inject kết quả; không client success flag/delay ngẫu nhiên; total=0 dùng cùng mock | Thử lại key mới sau đổi mode; key cũ giữ kết quả; không charge thật |
| Q16 — Lịch/nhóm/hosting | C | Capacity/ngày nộp là planning, public URL không bắt buộc | SCOPED: ba Sprint 1–2 tuần và Compose local; phân vai/lịch thực tại B02 | Scrum vẫn bắt buộc; không blocker thiết kế vì chưa có deadline/cloud |
| Q17 — AGENTS.md | B | Người dùng yêu cầu tạo nếu thiếu | RESOLVED: đã tạo root AGENTS.md theo hướng dẫn | Đóng thiếu nguồn hướng dẫn repository |
| Q18 — Versions | B | Không cần người dùng chọn từng package | RESOLVED: Node 24 LTS, Next 16/React 19, Nest 11, Prisma 7, PostgreSQL 18, TS 5.9; B03 pin patch tương thích + lockfile | Nhánh/policy đã chốt; build compatibility là check implementation, chưa chạy |
| Q19 — Bounds/timeout | B | Cần giới hạn nhỏ, không retry subsystem | RESOLVED: số liệu §4; không tự retry transaction, conflict 409, người dùng thử lại có kiểm soát | Tránh overflow/chờ vô hạn; không queue/backoff/worker |

**13 mục B đã giải quyết; 2 mục C giới hạn phạm vi; 4 mục A đã nhận USER DECISION.** Q02/Q16 không loại state machine, kiểm thử hoặc Scrum của PDF.

## 2. USER DECISIONS — ghi nhận ngày 2026-10-06

Người chốt: người dùng trong task DESIGN CLOSURE. Nội dung này thay toàn bộ recommended A/B cũ, không suy diễn việc chọn A cho cả bốn.

- **Q03:** Customer không tự hủy sau PAID; PENDING/CONFIRMED chỉ hủy nếu workflow hiện có cho phép; PAID/COMPLETED không customer cancel. Refund/payment reversal ngoài scope, không refund system phức tạp. Workflow hiện có chỉ PENDING/PAYMENT_FAILED cho Customer cancel; CONFIRMED không có trong PDF/enum nên không thêm. Cạnh PAID → CANCELLED nội bộ vẫn phải giữ theo PDF.
- **Q04:** itemPrice = baseProductPrice + sizeExtraPrice + sum(toppingPrice). Lấy giá DB, size có extra price/topping có price riêng; seed/demo không business constant; money DECIMAL(12,0). Không yêu cầu người dùng cung cấp bảng giá cố định mới.
- **Q10:** chỉ FIXED AMOUNT, finalAmount = max(0, orderTotal - discountAmount). orderTotal trong công thức là subtotal trước giảm; API orders.total/payments.amount là finalAmount. Không percentage. Discount configured của promotion có thể lớn hơn subtotal; order.discount_amount snapshot là min(subtotal, configuredDiscount).
- **Q11:** earnedPoints = floor(finalAmount / 10000), integer; cộng khi order chuyển PAID theo xác nhận DR14. Internal paid-cancel thu hồi đúng số đã cộng; COMPLETED không cộng lại. Không loyalty system phức tạp.

### Xác nhận cuối DR14/DR15 — người dùng, 2026-10-06

- **DR14 — CLOSED / ACCEPTED USER:** cộng `floor(finalAmount / 10000)` một lần tại PAID, lưu số gốc theo order trong loyalty_awards.points. Internal PAID → CANCELLED thu hồi đúng points của order đó; không tính lại từ policy/catalog/balance hiện tại. COMPLETED không cấp thêm điểm. Customer không hủy PAID. Không đổi/tiêu/hết hạn điểm.
- **DR15 — CLOSED / ACCEPTED USER:** internal PAID → CANCELLED hoàn toàn bộ qty đã trừ theo order_items snapshot gộp product, cùng transaction với status và loyalty rollback. CANCELLED không giữ inventory consumption và không giữ earned loyalty points.
- **Payment/refund:** chỉ cập nhật status/inventory/loyalty; giữ payment SUCCEEDED/amount và paid_at như lịch sử đã thanh toán. Không automatic refund, gateway reversal, settlement, reconciliation hoặc refund service. Hoàn tiền thực tế nếu cần là external/manual process ngoài scope, không thể hiện là hệ thống đã refund.

**OPEN QUESTIONS Q01–Q19: 0 chưa giải quyết.** Sau B08 supersede Q05: 12 quyết định kỹ thuật RESOLVED, 5 ACCEPTED USER và 2 SCOPED. DR14/DR15 đóng bằng câu trả lời người dùng, không dùng recommended option thay thế. Graph vẫn bảy trạng thái PDF, không thêm CONFIRMED.

## 3. Decision log hiện hành

Giữ các ID D cũ để truy vết; trạng thái sau đây thay thế trạng thái trước. ACCEPTED chỉ nghĩa chốt thiết kế, không có nghĩa code/test xong.

| ID | Status | Quyết định hiện hành |
| --- | --- | --- |
| D01 | REQUIRED | Next/Nest, REST, JWT/bcrypt/class-validator, mock; giữ cả Task 10 |
| D02 | ACCEPTED | Modular monolith, một PostgreSQL, mock local, Compose ba service |
| D03 | ACCEPTED | Prisma duy nhất, service DB mỏng; không generic repository/CQRS |
| D04 | ACCEPTED | Một repo, hai workspace, npm/lockfile; không Nx/Turborepo |
| D05 | ACCEPTED | Tailwind/Zustand/fetch; Cart PostgreSQL, frontend memory UI/cache (persistence cũ SUPERSEDED) |
| D06 | ACCEPTED | Customer + ownership; pha chế/paid-cancel service test, phạm vi gốc; được mở rộng bởi D35/D40 |
| D07 | ACCEPTED, thay BIGINT trước đây | DECIMAL(12,0) VND, JSON money string; server tính/snapshot theo công thức USER DECISIONS Q04/Q10/Q11 |
| D08 | ACCEPTED | Một transaction bao claim/business writes/response; service con không commit riêng |
| D09 | REQUIRED + ACCEPTED | Payment key unique scope + hash/replay, không external side effects |
| D10 | ACCEPTED | Create order dùng cùng cơ chế key; payment không tạo order |
| D11 | REQUIRED + ACCEPTED | Stock/version OCC, unique success/order và award/order; không tự retry transaction |
| D12 | SUPERSEDED → Q09 | Bỏ inventory_state/TTL; trừ/hoàn trực tiếp dựa transition + version |
| D13 | ACCEPTED | Mock local deterministic SUCCESS/FAILURE ở server |
| D14 | ACCEPTED | Bảy API PDF + GET detail + cancel unpaid; không public generic status API |
| D15 | ACCEPTED | HTTP/JSON/errors; validate cả FE/BE, backend authoritative |
| D16 | ACCEPTED | created_at/updated_at cho mutable; snapshot kế thừa thời điểm order |
| D17 | ACCEPTED | Snapshot/điểm lặp có invariant, một write path và tests |
| D18 | ACCEPTED USER | Giá DB/fixed discount/floor(finalAmount/10000) tại PAID; thu hồi đúng award khi internal paid-cancel |
| D19 | ACCEPTED | JWT memory 1h, bcrypt cost 10, register rồi login, không refresh |
| D20 | ACCEPTED | Filter/CORS cho JWT/key; ảnh seed thuộc frontend origin |
| D21 | ACCEPTED | Jest/Supertest + PostgreSQL thật, Playwright E2E; không coverage quota |
| D22 | ACCEPTED | Checklist chỉ Done việc thực tế; trạng thái hiện hành ở DEVELOPMENT_PLAN |
| D23 | SCOPED | Backend graph/test theo PDF, phạm vi gốc trước D35/D40; unpaid cancel owner |
| D24 | ACCEPTED USER | Customer không paid cancel; nội bộ hoàn tồn/thu hồi điểm cùng transaction, không refund/reversal; giữ graph |
| D25 | CLOSED | Chấp nhận PENDING chiếm tồn tới xử lý/hủy trong demo; không TTL/job |
| D26 | ACCEPTED USER | Mock Q15, FIXED AMOUNT Q10, Q11 cộng tại PAID, không COMPLETED award |
| D27 | CLOSED | Protocol <500 ms/browser đã chọn; chưa có kết quả đo |
| D28 | ACCEPTED TECHNICAL | Giữ loyalty_awards.points gốc, thêm reversed_at nullable (CHECK >= created_at khi có); effective earnedPoints = 0 khi đã thu hồi. CAS order + award guard/balance nguyên tử ngăn reverse lặp; không cash-refund table; journal bổ sung bởi D43 |
| D29 | ACCEPTED TECHNICAL — B04 | SQL-only 29 CHECK và partial payment success UQ bổ sung trong initial migration trước apply; seed catalog stable UUID/upsert giữ stock/version; PostgreSQL tests dùng schema UUID riêng trên DB local _dev/_test, không production/public fixture. Money D07 và business rules không đổi; orders index id DESC làm rõ representation đúng API sort |
| D30 | ACCEPTED TECHNICAL — B07 | JWT_SECRET env bắt buộc, min32bytes và không sample; JWT_EXPIRES_IN env/default3600, reject giá trị khác để giữ D19. Filter giữ envelope, honor explicit Auth error codes của API_DESIGN. Guard probe chỉ test harness; no me/logout/role endpoint. Zustand memory + TTL clear, safe local returnTo; không đổi requirements/schema/auth policy |
| D31 | ACCEPTED USER — B10 | Max1 PENDING/PAYMENT_FAILED per user; full request/Cart match; backend Cart write lock, owned existingOrderId discovery, replay first; Cart clear only after payment success. Create/read/cancel-unpaid in B10; Payment/Loyalty later. Details below |

## 4. Thông số kỹ thuật đã chốt

### Dữ liệu, giỏ và auth

- Tiền DECIMAL(12,0), 0..999.999.999.999 VND. Reject vượt giới hạn trước ghi. Backend dùng decimal chính xác; frontend dùng số nguyên chính xác/BigInt để tính giá dự tính, không float cho giá/discount. JSON tiền luôn chuỗi.
- TIMESTAMPTZ, created_at default now, updated_at do service cập nhật cùng mutation; không audit/event store.
- Cart PostgreSQL thuộc authenticated user; không guest cart/storage persistence. Reload/logout không xóa DB; login tải lại. Gộp product+size+normalized topping set; badge tổng qty. Backend giá DB/Decimal là source of truth.
- Checkout context lưu userId/orderId/key/payload nguyên bản/cart snapshot trước request. Reload login lại; chỉ resume cùng user, khác user xóa context cũ. Không guest cart trong B08. Close tab mất context là giới hạn demo; DB vẫn giữ lịch sử.
- Sửa giỏ đã gắn order: đọc trạng thái và hủy unpaid trước; chưa xác định kết quả thì giữ context, đọc lại/retry, không tạo đơn mới. Đơn paid không ép hủy; hiển thị current state. Không thay snapshot order đã tạo.
- Email trim/lowercase, tối đa 254 ký tự, unique dạng chuẩn hóa. Password 8–72 byte UTF-8, không trim/cắt ngầm; bcrypt cost 10.
- JWT HS256, TTL 3.600 giây, sub=user.id, secret server; guard kiểm tra chữ ký/algorithm/expiry/ownership. Token chỉ memory, không storage. Register không auto-login; login quay lại checkout. Không refresh/logout-server API.

### Bounds và timeout

| Mục | Giá trị demo |
| --- | --- |
| JSON body | Tối đa 64 KiB; vượt trả 413 |
| items | 1..50 sau chuẩn hóa; qty mỗi dòng 1..99, kiểm tra lại khi gộp |
| toppingIds | 0..10 ID khác nhau; tập hợp lệ theo product, policy Q04 |
| Idempotency-Key | 1..128 ký tự ASCII hiển thị, khuyến nghị UUID |
| promotionCode | 1..32 ký tự sau trim/uppercase; không dùng thì bỏ field |
| stock/points/version | INTEGER không âm; reject tăng vượt 2.147.483.647 |
| Tiền | 0..999.999.999.999; kiểm tra nhân/cộng/tổng |
| Pool wait / transaction deadline | 50 ms / 400 ms cho giao dịch demo |
| DB lock / statement timeout | 200 ms / 300 ms trong transaction; cấu hình theo adapter khi triển khai |
| Client timeout | 5 giây; không chứng minh server rollback, đọc lại/retry cùng key |
| Automatic transaction retry | 0; conflict trả 409, không background retry/backoff |

Bounds là bảo vệ kỹ thuật của đồ án, không phải business requirement gốc. Timeout không tự bảo đảm <500 ms; phải đo cả chờ thực tế. Unique conflict rollback trước, đọc lại kết quả một lần bằng transaction mới; chưa thấy kết quả trả 409 IDEMPOTENCY_IN_PROGRESS, không loop/job.

### Protocol NFR01 và browser

Đo trên máy demo, frontend/backend/PostgreSQL local Compose, backend build, không debug/delay mock. Ghi OS/CPU/RAM/runtime/container versions. Seed mẫu: 4 món wireframe, S/M/L/topping theo Q04, 2 user và 20 đơn; fixture riêng cho register/mutations. Mỗi endpoint: 10 warm-up + 50 request đo tuần tự, client local đo từ gửi tới nhận đủ JSON. Bao gồm bcrypt, validation, DB và mock. Ghi từng mẫu và min/mean/max; **mọi mẫu <500 ms**, không thay bằng average/p95. Data/stock chuẩn bị đủ trước khi đo write API; setup/reset không nằm trong thời gian một request.

Test lỗi/concurrency chạy riêng với PostgreSQL thật, ghi điều kiện và latency; protocol tuần tự không tuyên bố tải production. Nếu chậm phải sửa/báo không đạt, không bỏ NFR01. Browser: Chrome hoặc Edge và Firefox stable lúc B18, ghi exact version; viewport 390×844/1366×768. Playwright Chromium/Firefox, không cần grid/mobile native.

### Versions và B03

Node 24 LTS (>=24.11), Next 16/React 19, Nest 11, Prisma 7 với driver PostgreSQL phù hợp, PostgreSQL 18, TypeScript 5.9, Tailwind 4, Zustand 5. Dùng nhánh Nest 11 quen thuộc với class-validator/Passport; không đổi major chỉ vì generator default thay đổi. B03 chọn patch có bản sửa lỗi trong các nhánh này, pin dependency/lockfile và kiểm tra generate/build/lint/smoke tests. Exact patch là công việc setup đã có cách quyết định, không cần hỏi lại người dùng. Chưa tuyên bố compatibility thực đã pass.

Prisma 7 cần cấu hình module/driver đúng nhánh, không thêm Prisma cloud. Đối chiếu: [Node releases](https://nodejs.org/en/about/previous-releases), [Prisma 7 requirements](https://www.prisma.io/docs/orm/v7/reference/system-requirements), [Next installation](https://nextjs.org/docs/app/getting-started/installation), [PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html). Nguồn kỹ thuật không sinh requirement mới.

## 5. Ngoài phạm vi và điều kiện closure

Không staff/admin UI/role, public generic status mutation, provider/refund thật, ingredient/recipe, reservation TTL/cron, distributed lock/transaction, microservices, queue, cache, retry engine, cursor pagination với dataset nhỏ, hosting/cloud hay SLA uptime/load production. **Vẫn giữ** graph, idempotency, transaction + OCC, concurrency tests, khuyến mãi/điểm và API <500 ms vì PDF yêu cầu rõ.

PENDING giữ tồn tới xử lý/hủy là giới hạn demo công khai, không hứa availability production. Deadline/thành viên do B02 lập, không bịa dữ liệu và không chặn readiness thiết kế.

Q01–Q19/DR01–DR15 đã đóng hoặc SCOPED. B03/B04 foundation đã triển khai theo giao việc; business implementation vẫn ở backlog. Refund tiền thực tế là quy trình external/manual ngoài đồ án, không có refund/settlement/reconciliation service.

## D29 — B08 persistent Cart (ACCEPTED USER, 2026-10-07)

User explicitly replaces Q05/D05 client persistence: authenticated PostgreSQL Cart; four protected endpoints; no guest cart/userId input/inventory mutation. PATCH qty only; edit options POST new first then DELETE old, retain old on POST failure. Same configuration is a no-op edit. If DELETE fails after POST, retain both and offer deletion retry only; never repeat POST automatically. No checkout/order implementation. Technical Q19 bounds retained: 50 configurations, qty 1..99 after merge, <=10 unique toppings, monetary result <=999999999999.

## D30 — B09 internal pricing/validation (ACCEPTED USER, 2026-10-07)

User rejects new quote/preview endpoint; API_DESIGN §8 unchanged. B09 replaces old Order-domain backlog with reusable PricingModule/PricingService, no business writes and no frontend change. B10 is Order Creation and takes over Order-domain/state graph foundation; full workflow remains B16. Internal service accepts caller transaction client and JWT-derived userId; validates current persistent Cart and DB catalog, aggregates qty by product, recomputes Decimal VND. No promotionCode feature: optional trusted internal promotionId reads existing promotions.discount_amount/configuration; absent promotion gives zero discount. No promotion schema/seed changes. B10 must call engine again inside creation transaction and atomically check stock/version while decrementing through OCC; B09 result does not reserve or guarantee later availability. FR/PDF requirements unchanged.

## D31 — B10 active unpaid order and Cart lifecycle (ACCEPTED USER)

User confirms at most one active unpaid order per authenticated user: PENDING/PAYMENT_FAILED only. New key while active returns409 INVALID_ORDER_STATE with error.details.existingOrderId of that user's order. Same key/payload replay precedes current Cart/active-order validation; changed payload409 IDEMPOTENCY_KEY_REUSED. POST /orders retains baseline items/promotionCode; normalized UUID/size/topping set, merged qty, order-independent full Cart equality required, mismatch409 CONCURRENT_UPDATE. No client money/userId/status/stock input.

PENDING creation does not clear Cart. Cart GET remains available; POST/PATCH/DELETE are blocked while active unpaid exists, with the same discovery details. Existing GET /orders/:id and POST /orders/:id/cancel implemented in B10; no discovery endpoint. sessionStorage is retry/UX cache only, backend discovery works without it. Snapshot immutable. Customer cancel PENDING restores aggregated snapshot qty once with stock/version OCC in same transaction as CANCELLED; cancel PAYMENT_FAILED does not restore again. Cart preserved and unlocked after cancel. Payment phase must restore stock on failure once, keep Cart locked in PAYMENT_FAILED, re-acquire stock on retry using Order snapshot, and clear consumed CartItems/unlock at PAID. No Payment/Loyalty implementation in B10.

Technical enforcement uses existing short user-row lock for Cart writes/create/cancel, no new schema/reservation/TTL. Lock must precede FK-bearing claim insertion to avoid same-user lock-upgrade deadlocks; completed replay lookup still comes first. Future Payment writes must join this serialization rule. Product updates use aggregate qty + version CAS + bounds and sorted productId. Claims/business writes/response commit together; no auto transaction retry. Remaining full preparation/payment workflow stays later scope. PDF/FR requirements unchanged.
# P01-B2A technical implementation — 2026-10-17

User resume approval sau FIX01 cho phép initiation/status/retry, chưa cho phép enable
gateway hoặc settlement. Giữ frozen P00/L00/L01; [FIX01 amendment](P01B2A_LOYALTY_ATTRIBUTION_AMENDMENT.md)
là extension attribution duy nhất. Không migration mới.

Backend provider mode mặc định MOCK, không parse merchant credentials ở mode này.
VNPAY_SANDBOX bị từ chối lúc startup ngoài synthetic isolated test configuration;
explicit NODE_ENV=test một mình không đủ. Test gate ràng buộc DB loopback tên B2A,
hai DB URLs bằng nhau, fixture merchant/secret namespace/callback. Future activation
cần review/code change và approval sau IPN/reconciliation validation; không bật bằng
Customer input. Mock POST bị gate403 trong VNPAY mode theo P00 §17.

Initiation giữ PAY_ORDER namespace, SHA256 `{action:"VNPAY_INITIATE_V1",orderId}`;
owner→Order→Attempts→Claim/related→Products. PROCESSING claim không có order_id do
existing CHECK, complete/bind trước FIX01 RESERVE trong cùng transaction; không lộ
intermediate state trước commit. Không network/automatic transaction retry; budgets
50ms/400ms, lock200ms/statement300ms giữ nguyên. Existing unpaid cancellation dùng
cùng all-attempt/all-receipt guard; Mock giữ lịch sử và chặn cross-provider payment.

List có bounded encrypted keyset cursor owner/order-bound, cùng primitive AES-GCM/
HKDF như các read APIs hiện hữu, và `current` độc lập historical page. Existing Order
DTO không đổi; Checkout integration/optional summary chỉ giao riêng ở phase sau.
[API](API_DESIGN.md) / [implementation](P01B2A_VNPAY_INITIATION_IMPLEMENTATION.md).

## P01-B2C1 protocol gate conditional approval — 2026-10-17

User explicitly accepts P00 fixed15-field QueryDr response canonicalization and
independent synthetic HMAC-SHA512 vectors as implementation/testing evidence.
This resolves the recorded protocol gate; it does not verify VNPAY live response
compatibility or authorize activation. P00/FIX01 business decisions and schema stay
unchanged. Optional absent/empty retains segments; never try alternate signing
algorithms/formats or accept mandatory empty fields just because HMAC matches.

Python stdlib oracle generates static fixtures; strict JSON verifier and injectable
fixed Sandbox HTTPS client are implemented. Default transport is disabled, normal
mode MOCK. Existing IpnService T1 locks/bindings and T2 apply engine are reused.
Cross-source terminal equivalence compares money semantics rather than QueryDr API
responseCode against IPN decline code; two IPNs keep original strict comparison.
QUERYDR source and transactionType presence must match. UNKNOWN keeps reservations;
conflicts commit REVIEW without overwriting terminal Payment or clearing REVIEW.
Internal ADMIN/direct-loopback single-attempt action, persisted30s inquiry gate,
one network attempt/request, no scheduler/automatic retry/refund. No new migration.

**EXTERNAL SANDBOX RESPONSE VERIFICATION PENDING**: actual representative signed
responses or explicit provider optional-field confirmation is required before live
activation. A future contradiction with P00 requires STOP and separate approval.
[Preserved blocker, approval and implementation](P01B2C1_VNPAY_QUERYDR_RECONCILIATION.md).

## P01-B2C2 Decision A — preserve P00 §14 (USER APPROVED, 2026-10-17)

User explicitly selects OPTION A after B2C2-01: zero-total confirmation records
Award(points0)/EARN0, adds no available points, preserves valid redemption/debt
accounting and paid-cancellation evidence. Earlier task wording “Không ghi Loyalty
Award” is replaced. P00/L00/FIX01 and existing accounting constraints remain unchanged;
no amendment B or migration. Original blocker report is retained as history.

Implement CUSTOMER `/orders/:id/confirm-zero` under existing ownership/locks and
PAY_ORDER namespace with ZERO_COMPLETE_V1 discriminator. Only initial PENDING exact0;
strict input, no gateway history/unresolved money, existing financial outcome or
snapshot/account/Cart inconsistency. Payment0 uses existing INTERNAL_ZERO/ZERO_TOTAL
representation; Award0/EARN0/SETTLE/PAID/Cart/claim commit atomically. Inventory stays
reserved from creation; B16 cancellation restores stock/refunds redemption/REVERSE0
while preserving Payment0/paidAt. Existing Mock/IPN/QueryDr engines and hashes unchanged.

Internal confirmation does not require or activate VNPAY credentials, Mock or network.
Normal mode MOCK; QueryDr external verification PENDING. No Return/Checkout/tunnel/
Sandbox calls/Refund. [Decision, implementation and evidence](P01B2C2_ZERO_TOTAL_INTERNAL_CONFIRMATION.md).

## P01-D4C cancellation/recovery UX ? owner-authorized implementation (2026-10-21)

Owner requested Home navigation after verified customer cancellation and explicit
CLOSED admission messaging. Use a minimal optional CUSTOMER_CANCELLED reason in
existing owned read-only status DTOs, derived from applied persisted verified24/02,
never from Return query parameters. Frontend navigates within the app and keeps a
notification bound to the current in-memory authenticated session. No auth/token
persistence or callback protocol change. UNKNOWN/REVIEW and generic failures do
not navigate as cancellation. Admission remains a backend capability; one-attempt
closure belongs to the approved test supervisor, not normal customer retry policy.
Owner confirms BREW10K was selected intentionally:40000-10000=30000 is correct; no
PricingService or promotion rule change. Report (báo cáo/evidence lịch sử đã dọn; hướng dẫn hiện hành tại [Normal Mode](NORMAL_SANDBOX_MODE.md)).

## Normal VNPAY Sandbox launcher ? ACCEPTED USER (2026-10-21)

Owner explicitly replaces routine one-Attempt/30-minute/manual Gate operation with
normal optional local Sandbox. Those restrictions remain only in the historical
E2E harness. Admission uses validated provider configuration, health and explicit
drain, independent of count/time. Existing per-Order URL TTL, signature/IPN settlement,
Return read-only, idempotency and financial capabilities remain unchanged.

Tracked Node scripts provide Windows/PowerShell npm commands, owned child handles,
loopback authenticated management and parent-only backend IPC. Source-addressed
frontend snapshots preserve original next-env bytes. Private merchant/ngrok settings
are optional for VNPAY; default MOCK reads no merchant overlay and uses no tunnel.
No default remote DB/production gate relaxation or staging deployment. Unsafe stop
retains callbacks/profile; service recovery never forces a payment outcome.
[Operation](NORMAL_SANDBOX_MODE.md), tests (báo cáo/evidence lịch sử đã dọn; hướng dẫn hiện hành tại [Normal Mode](NORMAL_SANDBOX_MODE.md)).

## Normal Sandbox admission and safe shutdown — ACCEPTED USER (2026-10-21)

Owner requests that an unresolved Attempt must not interrupt independent customers.
Existing financial contracts and per-Order guards remain unchanged. Dependency
counts govern safe teardown, not healthy VNPAY admission. AWAITING expired/UNKNOWN
retains inventory/redemption reservations and callback verification; another Order
may proceed under its own stock, ownership, idempotency and gateway guards.

Coordinator records OPERATOR_DRAIN versus STOP_REQUESTED; healthy monitoring must
preserve active stop intent and callback-retention status. Explicit dev:recover
cancels operator drain/stop intent after callback/service readiness checks, even
when safeToStop=false. Automatic health recovery never cancels explicit intent.
No financial writes, QueryDr activation, quota or session gate is part of recovery.
Existing running parent is not hot-reloaded; use its existing recovery path and
defer replacing it until safe shutdown. See [operation](NORMAL_SANDBOX_MODE.md).
