# A00 — BrewLite Admin & Staff Contract

**A07-D/A07 CANCELLED / rollback được người dùng phê duyệt ngày 2026-10-15.**
Campaign, Admin Promotion Management, Customer discovery và banner A07 bị hủy.
Các ghi chú A07 PLANNED trong những checkpoint cũ bên dưới chỉ còn giá trị lịch sử,
không phải phạm vi đang triển khai. B13/BREW10K, A01–A06/UI01 và L00/L01 được giữ.
Trạng thái apply, migration và regression hiện hành: [rollback report](DECISIONS.md).

**A06 IMPLEMENTED / READY / D42:** two approved migrations
verified before development apply, existing persistent idempotency/shared Product OCC,
ADMIN read/adjust APIs/UI/create shortcut follow §5–7/10/12/14 AS-T11–12/14/15.
Exact InventoryItem preserved; UI reads lifecycle status through existing Product GET.
Unresolved contention IN_PROGRESS after one recovery read; stale/CAS CONCURRENT_UPDATE;
keep original key/body until confirmation. [A06](A06_INVENTORY_MANAGEMENT_CONTRACT.md).
Historical PLANNED/proposal notes superseded only for A06; A07/B17 remain PLANNED.

**A05 IMPLEMENTED / READY under explicit USER approval D41:** [A05](A05_SIZE_TOPPING_MANAGEMENT_CONTRACT.md) implements §5–9/12/14 AS-T10/14/15. AD02 lifecycle plus Topping.version/default0/CHECK approved explicitly, superseding only earlier A05 prompt restriction. Parent Product OCC for size/association/global Topping own OCC/no cascade/history preservation/public active options/persistent Cart warning/read-time pricing retained. A04 phased Product DTO unchanged; dedicated A05 projections/current revisions. No ProductTopping flag/stock mutation/A06–A07/B17;328/163/365+lint/build/Prisma5 migrations+real Edge PASS. Historical design notes below superseded only for assigned A05 scope.

**UI01 approved supersession, D40:** [current contract](UI01_ROLE_BASED_INTERFACE_CONTRACT.md) narrows STAFF reads from historical A02 all-status access: default PAID/PREPARING/READY; exact filter additionally COMPLETED; forbidden three states403, direct hidden detail404. ADMIN retains seven states. Shared login role destinations/customer versus operations layouts/Admin overview and Orders UI approved; A03/A04 contracts otherwise preserved. UI01 verification PASS291/152/347+lint/build/Prisma+real Edge; A05–A07/B17 PLANNED. Original A00 design/evidence below retained as history.

**A04 IMPLEMENTED / READY, 2026-10-13:** [A04](A04_ADMIN_PRODUCT_MANAGEMENT_CONTRACT.md)/D39 USER approvals: phased sizes/toppings without A05 flags/version, AD01 Product.isActive migration, active-stock-valid-size availability/Cold brew preservation. ADMIN CRUD/stock0 explicit-size create/shared OCC/no-reference delete/retained Cart/new checkout backend validation/snapshot retry/UI, AS-T09/14/15 and277/145/336+Edge PASS. A05–A07 PLANNED. Historical planned notes below superseded only for A04.

**A03 implementation update, 2026-10-12:** [A03](A03_STAFF_WORKFLOW_CONTRACT.md) implements EXT-AS03 preparation POST STAFF/ADMIN và ADMIN-only paid-cancel theo §3/5–7/12/14 AS-T06–08/14. Direct B16 reuse, no business rule/schema/engine change, original expectedVersion/owner lock/CAS/reversal/no-refund semantics kept. A04–A07 PLANNED; historical A00/A01/A02 restrictions below are superseded only for A03 explicitly assigned by user.

**A02 implementation update, 2026-10-12:** [A02](A02_OPERATOR_ORDER_MANAGEMENT_CONTRACT.md) implements EXT-AS02 read-only list/detail APIs và frontend routes theo §3/5–7/12/14 AS-T05/14, reuse B10/B15 snapshots/current revision và A01 DB guards. Không essential contract change/new decision/schema/engine; A03–A07 business actions/management vẫn PLANNED. Các câu “mọi API/UI PLANNED” dưới đây giữ A00 design snapshot, superseded chỉ cho A01 và A02 đã giao.

**A01 implementation update, 2026-10-11:** [A01](A01_RBAC_AUTH_CONTRACT.md)/D38 implements UserRole/User.role migration, auth response role, RolesGuard/customer permissions, gated create-only CLI và minimal `/operator/orders`/`/admin/products` shells theo user task. Scope notes A00 bên dưới giữ design snapshot; operator/admin business APIs/UI và A04–A07 schema vẫn PLANNED, AD01/AD02 flags chưa implement. Shell không Order table/Product CRUD, B16 không exposed.

Ngày: 2026-10-11 (Asia/Saigon). **USER-APPROVED EXTENSION** theo chỉ đạo A00 của người dùng. A00 chỉ hoàn thiện tài liệu; mọi API, route, schema và CLI mới dưới đây là **PLANNED, NOT IMPLEMENTED**. Không migration, application code, package, B17 hoặc full UI redesign trong task này.

Finalization từ checkpoint `d75457db771678d300452c35e1ecaf67d3ea142b`: người dùng xác nhận **AD01 APPROVED / AD02 APPROVED**, 2026-10-11; ghi nhận [DECISIONS D37](DECISIONS.md). Product lifecycle thuộc A04, Size/Topping lifecycle thuộc A05, không A00/A01. **ADMIN CONTRACT READY**; approval không đồng nghĩa schema/API đã implement.

## 1. Extension scope và nguồn

Phê duyệt A00–A07: contract/design; RBAC/auth/provisioning; operator Order UI; Staff workflow/Admin PAID cancellation; Product; Size/Topping; Inventory; Promotion management. A08 Customer Management và A09 Reporting/Statistics **NOT APPROVED**, chỉ thêm khi người dùng phê duyệt riêng. Không customer-account CRUD, revenue dashboard, staff-management UI, public operator registration, Payment/Loyalty editing, refund, ingredient, ledger hoặc engine mới.

PDF [BrewLite VER 1.0](BrewLite-CongNghePhanMem.pdf) đã đọc lại đủ 8 trang; SHA256 `08EFC9A6CC247123500419F01160C76712EC773AFFC998D2193F2873EF5312CC`, giữ nguyên. §3.2 pPDF4 nói Barista là phần mở rộng; §9/9.1 pPDF7–8 yêu cầu domain graph, không bắt buộc Admin UI. FR01–16/NFR01–10/BR01–14 và bảy API PDF không được thêm/bỏ/đổi vì extension. ID EXT-AS dưới đây là yêu cầu người dùng, không FR mới của PDF.

Đã đối chiếu [AGENTS](../AGENTS.md), [README](../README.md), REQUIREMENTS, API_DESIGN, DATABASE_DESIGN, ARCHITECTURE, DECISIONS, DEVELOPMENT_PLAN, TRACEABILITY_MATRIX, PROJECT_STRUCTURE, DESIGN_REVIEW; B05/B07/B09/B10/B11/B13/B15/B16 và source hiện tại. Không tìm thấy artifact riêng mang tên ADMIN & STAFF GAP ANALYSIS trong repository; quyết định người dùng trong task này là nguồn scope, không giả lập nội dung báo cáo đó.

HEAD đầu task `27a4af919276cc7004f02ad69be4b61a90496abc`. Chỉ có diff sẵn `frontend/next-env.d.ts` đổi `.next/types` sang `.next/dev/types`; giữ nguyên, không stage. SHA256 pre-flight `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`. Baseline B16 đã PASS kỹ thuật theo evidence có sẵn; A00 không chạy lại hoặc suy ra operator implementation đã PASS.

[DECISIONS D35/D36](DECISIONS.md) supersede **chỉ giới hạn scope** Q02/D06/D14/D23 và DR04 cho extension đã duyệt; lịch sử cũ/B16 evidence giữ nguyên. Q03/DR14/DR15 vẫn cấm Customer paid-cancel và giữ cancellation effects/no refund. AD01/AD02 đã APPROVED tại D37/§16, độc lập với A01; không còn open decision trong contract A00.

## 2. Requirement mapping và reuse

| Extension ID | Yêu cầu người dùng / task | Baseline tái sử dụng; không nhận là requirement PDF mới |
| --- | --- | --- |
| EXT-AS01 | CUSTOMER/STAFF/ADMIN, DB role, private provisioning — A01 | B07; FR04/05, NFR02/10; JWT/bcrypt/ownership |
| EXT-AS02 | Operator list/detail mọi Order — A02 | B15/B10; FR09/10 read projection, BR11 snapshots |
| EXT-AS03 | Staff/Admin preparation, Admin-only PAID cancel — A03 | B16; FR11/12/14/16, BR05/12/13, DR14/DR15 |
| EXT-AS04 | Product CRU/lifecycle/delete an toàn — A04 | B05/B09/B10; FR01/02/06, BR09/11; lifecycle AD01 APPROVED, PLANNED A04 |
| EXT-AS05 | Size S/M/L, Topping lifecycle và associations — A05 | B05/B09/B10; FR02/03/06, BR10/11; lifecycle AD02 APPROVED, PLANNED A05 |
| EXT-AS06 | Admin adjustment Product.stock, delta/OCC/idempotency — A06 | B10/B11/B16 stock lifecycle + common idempotency; FR14, NFR06/10 |
| EXT-AS07 | Admin Promotion management FIXED AMOUNT — A07 | B13/B09/B10/B11; FR15, BR08/11/14, snapshot/retry |

Operator interfaces gọi services hiện tại. Không gọi owner-only `get/history` với operator ID để đọc đơn khách, không spoof JWT owner, không mở customer routes thành global access. B15 projection có thể dùng chung cho authorized cross-owner read; B16 `transitionOrder(orderId, expectedVersion, targetStatus)` là nơi duy nhất xử lý internal transition. Management services chỉ ghi catalog/config/adjustment được cho phép; không viết lại pricing, create, payment, award/reversal engines.

## 3. RBAC permission matrix

| Hành động | CUSTOMER | STAFF | ADMIN |
| --- | --- | --- | --- |
| Public Catalog/register/login | Có | Có Catalog/login | Có Catalog/login |
| Customer Cart/create/pay/history/detail/loyalty/cancel unpaid | Giữ hiện tại, owner-only | Không cấp thêm quyền customer qua role này | Không cấp thêm quyền customer qua role này |
| GET operator Order list/detail, mọi owner | Không | Có | Có |
| PAID → PREPARING; PREPARING → READY; READY → COMPLETED | Không | Có | Có |
| PAID → CANCELLED | Không | Không | Có, B16 transaction |
| Operator cancel unpaid / PREPARING / READY / COMPLETED | Không | Không | Không |
| Product / Size / Topping read/write quản trị | Không | Không | Có |
| Inventory read/adjust | Không | Không | Có |
| Promotion read/write quản trị | Không | Không | Có |
| Sửa Order.total, Payment.status/amount, Loyalty.balance/award | Không | Không | Không |
| Customer account management / revenue reporting | Không | Không | Ngoài scope A08/A09 |

Đây là các permission độc lập, không suy ra ADMIN được impersonate Customer hoặc STAFF được mọi quyền Customer. A01 giữ các endpoint customer hiện có cho CUSTOMER; operator dùng namespace riêng. Không role gửi từ client/header/JWT claim nào được dùng làm quyền. Backend resolve DB role mỗi request, deny-by-default; unauthenticated401, authenticated wrong-role403 **FORBIDDEN**, trước lookup resource/replay. UI chỉ hỗ trợ UX.

## 4. Proposed Prisma migration — PLANNED

### A01: IMPLEMENTED theo phê duyệt người dùng

Snippet minh họa bổ sung vào model hiện hành, không phải file schema đã sửa:

```prisma
enum UserRole {
  CUSTOMER
  STAFF
  ADMIN
}

// In existing model User:
// role UserRole @default(CUSTOMER)
```

PostgreSQL native enum `UserRole`; `users.role` NOT NULL DEFAULT CUSTOMER. Migration mới append-only ở A01: tạo enum, thêm cột với default, bảo đảm mọi existing row CUSTOMER, kiểm tra count/no NULL/no unexpected role. Không tạo/sửa User/password/Cart/Order/Payment/Loyalty data khác; không sửa initial migration đã apply. Public register ghi CUSTOMER rõ ràng và reject role field; seed không upsert/nâng role. Existing JWT vẫn sub/iat/exp; DB role mới quyết định quyền ngay request tiếp theo. Login/register response user bổ sung `role`; JWT không thêm authoritative role claim. Chưa tạo migration hoặc chạy Prisma trong A00.

Prisma enum/default phù hợp nhánh ORM7 đang pin; không áp dụng tài liệu ORM8 để đổi stack. [Prisma ORM7 schema reference](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference).

### Các migration sau, không gộp vào A01

| Task | Schema/constraint PLANNED | Gate |
| --- | --- | --- |
| A04 | Dùng Product.version có sẵn; Product.isActive Boolean @default(true)/map is_active | AD01 APPROVED; migration/implementation A04, existing Product active |
| A05 | Topping.version Int default0, CHECK>=0; Size/association dùng parent Product.version, không bảng Size mới | Kỹ thuật OCC cùng lifecycle AD02 tại A05 |
| A05 lifecycle | ProductSize.isActive và Topping.isActive Boolean @default(true)/map is_active | AD02 APPROVED; migration/implementation A05, existing options active; không ProductTopping field mới |
| A06 | IdempotencyOperation thêm ADJUST_INVENTORY, sửa CHECK idempotency_result_check theo operation tại §10 | Không bảng/ledger mới; preserve CREATE_ORDER/PAY_ORDER |
| A07 | Promotion.version Int default0, CHECK>=0; backfill0; FK Order→Promotion Restrict giữ nguyên | Concurrency §11 |

Stock/points/version luôn 0..2147483647; tiền DECIMAL(12,0); FK/UQ/SQL-only CHECK hiện hành giữ nguyên trừ CHECK completion nêu rõ ở A06. No new Order/Payment status, role-permission tables hoặc generic admin CRUD. Migration A01 verify existing/new-user defaults, generate/validate/status, isolated PostgreSQL migration tests và customer regression. Không rollback bằng reset/drop dữ liệu; nếu code rollback, schema additive có thể giữ và operator bị disable; không tự chuyển privileged account về CUSTOMER hoặc drop role mất dữ liệu.

A04/A05 thêm cột is_active NOT NULL DEFAULT true, backfill **mọi existing Product/ProductSize/Topping active**, không sửa stock/giá/Cart/history. Migration additive mới, không sửa migration đã apply, không xóa/reset PostgreSQL, không thay Order/Payment/Loyalty history. Khóa count/FK/history fingerprints trước/sau trong isolated migration tests; nếu dữ liệu cũ có Product thiếu size hợp lệ, báo finding để xử lý có chủ đích, không tự backfill inactive hoặc xóa record. Không chạy migration hoặc application implementation trong A00/A01 cho lifecycle.

## 5. Operator API contract — toàn bộ PLANNED

REST root backend; namespace `/operator` cho STAFF/ADMIN, `/admin` cho ADMIN. Không đổi customer paths. UUID params; query whitelist; JSON64KiB; private/no-store/Vary Authorization, giữ Vary Origin; CORS hiện có cho Authorization/Content-Type/Idempotency-Key và expose Idempotency-Replayed.

| Method + path | Quyền | Input | Success | Task |
| --- | --- | --- | --- | --- |
| GET /operator/orders | STAFF, ADMIN | Optional status đúng một OrderStatus; không body/query khác | 200 `{items:OperatorOrderSummary[]}` | A02 IMPLEMENTED |
| GET /operator/orders/:id | STAFF, ADMIN | UUID; empty query/body | 200 OperatorOrderDetail | A02 IMPLEMENTED |
| POST /operator/orders/:id/transitions | STAFF, ADMIN | `{expectedVersion,targetStatus}` | 200 B16 detail; GET operator detail để lấy version mới | A03 IMPLEMENTED |
| POST /admin/orders/:id/paid-cancel | ADMIN | `{expectedVersion}` | 200 B16 detail; GET current detail sau đó | A03 IMPLEMENTED |
| GET /admin/products; GET /admin/products/:id | ADMIN | Empty query/body | 200 list/detail | A04 |
| POST /admin/products | ADMIN | ProductCreate | 201 AdminProduct | A04 |
| PATCH /admin/products/:id | ADMIN | ProductUpdate | 200 AdminProduct | A04 |
| DELETE /admin/products/:id | ADMIN | `{expectedVersion}` | 204, no body | A04 |
| GET /admin/products/:id/sizes | ADMIN | Empty query/body | 200 `{items:AdminSize[],productVersion}` | A05 |
| POST /admin/products/:id/sizes | ADMIN | `{size,extraPrice,expectedVersion}`; isActive default true server-owned | 201 `{item:AdminSize,productVersion}` | A05 |
| PATCH /admin/products/:id/sizes/:size | ADMIN | `{expectedVersion,extraPrice?,isActive?}` | 200 `{item:AdminSize,productVersion}` | A05 |
| DELETE /admin/products/:id/sizes/:size | ADMIN | `{expectedVersion}` | 204 | A05 |
| GET /admin/toppings; GET /admin/toppings/:id | ADMIN | Empty query/body | 200 list/detail | A05 |
| POST /admin/toppings | ADMIN | `{name,price}` | 201 AdminTopping | A05 |
| PATCH /admin/toppings/:id | ADMIN | `{expectedVersion,name?,price?,isActive?}` | 200 AdminTopping | A05 |
| DELETE /admin/toppings/:id | ADMIN | `{expectedVersion}` | 204 | A05 |
| GET /admin/products/:id/toppings | ADMIN | Empty query/body | 200 `{items:AdminTopping[],productVersion}` | A05 |
| POST /admin/products/:id/toppings | ADMIN | `{toppingId,expectedVersion}` | 201 `{items:AdminTopping[],productVersion}` | A05 |
| DELETE /admin/products/:id/toppings/:toppingId | ADMIN | `{expectedVersion}` | 204 | A05 |
| GET /admin/inventory | ADMIN | Empty query/body | 200 `{items:InventoryItem[]}` | A06 |
| POST /admin/products/:id/inventory-adjustments | ADMIN | Idempotency-Key + `{delta,expectedVersion}` | 200 InventoryAdjustmentResult | A06 |
| GET /admin/promotions; GET /admin/promotions/:id | ADMIN | Empty query/body | 200 list/detail | A07 |
| POST /admin/promotions | ADMIN | PromotionCreate | 201 AdminPromotion | A07 |
| PATCH /admin/promotions/:id | ADMIN | PromotionUpdate | 200 AdminPromotion | A07 |
| DELETE /admin/promotions/:id | ADMIN | `{expectedVersion}` | 204 | A07 |

List quản trị `{items:[...]}`, empty valid; Product/Topping/Promotion/Inventory id ASC, sizes S/M/L, operator Orders createdAt DESC/id DESC. Dataset demo không pagination/search/dashboard; filter status chỉ ở operator list. Không method PATCH generic Order/status, không Order PATCH/Payment/Loyalty write API. A02 chỉ read; A03 mới expose actions. AD01/AD02 APPROVED: isActive boolean thuộc planned PATCH Product/Size/Topping tại A04/A05; create các entity mặc định active, không nhận isActive trong create DTO. Lifecycle chưa có trong running API trước phase implementation.

Envelope giữ `{error:{code,message,details,requestId}}`; không lộ raw SQL/Prisma/stack/hash/token. Auth DB lookup fault giữ sanitized500 INTERNAL_SERVER_ERROR của B07; authorized operator/management read/write technical faults503 SERVICE_UNAVAILABLE. Error contract mới:

| HTTP/code | Khi nào / xử lý |
| --- | --- |
| 400 VALIDATION_ERROR | UUID/query/body/bounds/unknown field/empty PATCH sai; null không thay omission |
| 400 MISSING_IDEMPOTENCY_KEY | Inventory không có key; malformed key400 VALIDATION_ERROR |
| 401 UNAUTHORIZED / 403 FORBIDDEN | JWT/user sai / DB role không có quyền; không lookup tài nguyên trước403 |
| 404 ORDER_NOT_FOUND / PRODUCT_NOT_FOUND / SIZE_NOT_FOUND / TOPPING_NOT_FOUND / PROMOTION_NOT_FOUND | Sau authorize, resource thiếu |
| 409 INVALID_ORDER_STATE | Target không thuộc cạnh đúng; terminal/skipped/unpaid paid-cancel |
| 409 CONCURRENT_UPDATE | Stale expectedVersion, CAS0, recognized lock/transaction timeout; GET rồi xác nhận lại |
| 409 RESOURCE_IN_USE | Reference/FK hoặc last-size guard; không cascade, không sửa lịch sử/Cart |
| 409 PRODUCT_UNAVAILABLE | PLANNED A04: Product inactive khi customer add/PATCH qty/create Order mới; Cart DELETE vẫn cho phép |
| 409 RESOURCE_ALREADY_EXISTS | Trùng product-size/association hoặc PROMOTION code unique (code-specific PROMOTION_CODE_EXISTS) |
| 409 INVALID_STOCK_ADJUSTMENT | Stock sau delta âm hoặc vượt INTEGER; rollback |
| 409 IDEMPOTENCY_KEY_REUSED / IDEMPOTENCY_IN_PROGRESS | Payload khác key cũ / chưa có committed result; retry cùng key cho request chưa xác định |
| 503 SERVICE_UNAVAILABLE | Technical/invariant/overflow version; rollback, không giả success/decline |

422 PROMOTION_INVALID của B13 vẫn dành cho customer eligibility khi tạo Order; admin DTO cấu hình sai400 VALIDATION_ERROR. Customer error codes baseline giữ nguyên; A04 bổ sung409 PRODUCT_UNAVAILABLE cho inactive Product, A05 dùng400 INVALID_ITEM_OPTIONS hiện có cho inactive options; chưa áp vào runtime tại A00/A01. Record FK race luôn map409 RESOURCE_IN_USE thay500; P2002 race promotion code409 PROMOTION_CODE_EXISTS.

## 6. Request/response DTO

Common: version/expectedVersion integer0..2147483647; không coercion string/lẻ; money là chuỗi chữ số canonical0..999999999999; timestamps ISO8601 có timezone→UTC. Name trim1..120 chars; không category/description/upload. imageUrl chỉ relative `/images/` path, max512, không scheme/traversal; quản lý asset ngoài task. UUID chuẩn hóa lower-case; size S/M/L, code trim/uppercase1..32. PATCH cần ít nhất một mutable field ngoài expectedVersion. DELETE body JSON expectedVersion, không query token/secret.

| DTO | Fields chính xác |
| --- | --- |
| AuthUser (A01 extension B07) | `{id,email,loyaltyPoints,role:CUSTOMER\|STAFF\|ADMIN}`; register201 `{user}`, login200 `{accessToken,tokenType:"Bearer",expiresIn:3600,user}` |
| OperatorOrderSummary | B15 summary `{id,orderCode,status,total,currency:"VND",createdAt,earnedPoints}` + `{version,updatedAt}`; earnedPoints number/null như B15 |
| OperatorOrderDetail | B10/B15 detail `{id,orderCode,status,currency,items,subtotal,discountAmount,total,promotionCode,createdAt,paidAt,earnedPoints,paymentStatus}` + `{version,updatedAt}` |
| B16 action result | B10/B15 detail fields trên, **không version/updatedAt**; giữ return B16 hiện có, frontend GET operator detail sau success/lost response |
| Order item | `{productId,productName,size,qty,unitPrice,lineTotal,toppings:[{name,price}]}` từ snapshot; không current catalog recompute |
| ProductCreate | `{name,price,imageUrl,sizes:[{size,extraPrice}],toppingIds}`; 1..3 distinct sizes, 0..10 distinct existing topping IDs; create stock0/version0 server-owned |
| ProductUpdate | `{expectedVersion,name?,price?,imageUrl?,isActive?}`; isActive boolean AD01/A04; không stock/version/total hoặc inline options update |
| AdminProduct A04 | `{id,name,price,imageUrl,stock,isActive,version,createdAt,updatedAt,sizes:[{size,extraPrice}],toppings:[{id,name,price,createdAt,updatedAt}]}`; IMPLEMENTED D39, no A05 option flags/Topping.version |
| AdminSize | `{productId,size,extraPrice,isActive}`; PLANNED A05, concurrency dùng `productVersion` |
| AdminTopping | `{id,name,price,isActive,version,createdAt,updatedAt}`; PLANNED A05 |
| InventoryItem | `{productId,productName,stock,version}` |
| InventoryAdjustmentResult | `{productId,delta,previousStock,stock,version}`; committed result của request, GET để current state |
| PromotionCreate | `{code,discountAmount,minimumSubtotal,startsAt,endsAt,isActive}` |
| PromotionUpdate | `{expectedVersion,discountAmount?,minimumSubtotal?,startsAt?,endsAt?,isActive?}`; code immutable sau create |
| AdminPromotion | `{id,code,discountAmount,minimumSubtotal,startsAt,endsAt,isActive,version,createdAt,updatedAt}`; FIXED AMOUNT implicit, không discountType mới |

Operator Order DTO không owner email, password/hash, JWT, user balance, raw Payment/award/claims; không cần customer management để pha chế. Đọc stock/version chỉ qua Admin projections, không thêm vào public Catalog/customer Order. Auth role response là UX hint; backend DB vẫn authoritative. Product create atomic product + size + association; topup riêng A06, không initial arbitrary stock trong Product CRUD.

Ví dụ Inventory request (POST path xác định product, key header riêng):

```json
{"delta": 5, "expectedVersion": 7}
```

Ví dụ committed result khi stock10/version7:

```json
{"productId":"11111111-1111-4111-8111-111111111111","delta":5,"previousStock":10,"stock":15,"version":8}
```

## 7. Status/version concurrency rules

Operator list/detail đọc status/version trong cùng projection của một DB read, không nối version từ query sau vào snapshot cũ. expectedVersion do operator GET cung cấp, không tự thay bằng version reread. Targets transitions chỉ PREPARING/READY/COMPLETED; CANCELLED qua ADMIN paid-cancel riêng; PAID/PENDING/PAYMENT_FAILED bị DTO reject400 ở transitions. B16 kiểm tra graph, current state và CAS dưới lock owner như hiện tại.

B16 giữ transaction maxWait50ms/deadline400ms, DB lock200ms/statement300ms; user lock của **Order owner**, không lock operator thay owner; aggregate/sort Product IDs; status/version/timestamp/stock/award/balance cùng cancellation transaction. Wrapper authorize trước rồi gọi B16, không mở transaction ngoài và không tự cập nhật version/status. Return B16 projection không version; GET operator đọc current state sau đó, tránh ghép dữ liệu từ hai thời điểm thành một response giả nhất quán.

Preparation lost response: GET current detail. Nếu đúng target/đã tiến xa hơn, hiển thị current state và dừng; không tự chuyển bước tiếp. Nếu còn nguyên source+version, retry **cùng target và expectedVersion gốc**; cạnh đã thực hiện trả409, không tăng version lần hai. Stale command không được đổi expectedVersion để biến click cũ thành bước mới. Không claim idempotent response replay cho preparation.

Paid-cancel repeat CANCELLED trả current detail no-op theo B16, kể cả expectedVersion cũ; đây không là graph self-edge và không chứng minh chính request đó đã paid-cancel (đọc paidAt/paymentStatus). Unpaid non-CANCELLED bị409; STAFF luôn403 kể cả CANCELLED. Cancel vs prepare chỉ một cạnh thắng; nếu prepare thắng cancel bị409, không đảo PREPARING. Customer paid-cancel hiện có vẫn409; mọi role bị cấm direct payment/loyalty edits.

Catalog mutations: Product và size/association dùng parent Product.version có sẵn, bump+1/updatedAt cùng transaction; stock changes B10/B11/B16/A06 bump cùng version, nên stale catalog edit có thể conflict vì tồn thay đổi. Topping.version riêng, Promotion.version riêng; mỗi successful mutation bump đúng một lần, overflow503 rollback. Không overwrite toàn record, không read-modify-write stock/points. No automatic transaction retry.

Management PATCH/delete mất response: GET current resource; không auto-resubmit/create duplicate. OCC prevents reapplying PATCH với version cũ. DELETE retry resource đã thiếu404 là trạng thái đọc, không body replay. Product/Topping/Promotion create không có idempotency guarantee: giữ form và kiểm tra danh sách sau timeout trước thao tác tạo mới; UI không tự retry POST. Idempotency bắt buộc chỉ adjustment có delta; workflow theo B16 như trên.

## 8. Product lifecycle/delete policy

CRU đã duyệt, delete chỉ no-reference, FK Restrict. Product price/name/image thay đổi không reprice snapshot Order; Cart dùng giá hiện tại B08/B09. Product create stock0 là hết tồn ban đầu, không giả ngừng kinh doanh; ghi tồn chỉ A06. Active product phải có ít nhất một size hợp lệ; last size không xóa được.

DELETE Product chỉ khi không OrderItem/CartItem hoặc reference nghiệp vụ khác. ProductSize/ProductTopping là cấu hình con: service kiểm tra mọi consumer/FK, xóa **explicit** cấu hình con và Product trong **cùng transaction** sau parent version guard; không DB cascade. Last-size guard của endpoint xóa size riêng không áp cho cleanup trong transaction full-product deletion đã xác nhận không consumer. Nếu có Order history hoặc Cart,409 RESOURCE_IN_USE, không force/remove Cart/null FK. Race create/order/delete phải parent serialization/transaction/FK và Product version bảo vệ; không commit Product rỗng size ở giữa, snapshot không cho phép bỏ referential integrity.

**AD01 APPROVED — ACCEPTED USER, 2026-10-11; PLANNED A04:** `Product.isActive Boolean @default(true)`, existing Product backfill active. isActive=true/stock>0 cho phép đặt nếu các điều kiện khác hợp lệ; isActive=true/stock=0 là hết hàng; isActive=false là ngừng kinh doanh, không nhận Order mới dù stock>0. Không dùng stock=0 để ngừng bán; bật/tắt flag không thay stock. Không xóa Cart/history, không reprice Order snapshot hoặc Payment retry.

Behavior lifecycle đã được duyệt từ proposal A00: public list ẩn inactive; detail inactive404 theo B05 NOT_FOUND; Admin list vẫn thấy. Cart đã có giữ dòng/display unavailable/thông báo điều chỉnh, DELETE cho phép; add/PATCH qty và create Order mới chặn409 PRODUCT_UNAVAILABLE. Reactivation không nhập tồn. Payment retry của Order đã tạo dùng snapshot và stock OCC, không revalidate flag hoặc giá hiện tại; B16 vẫn restock/reverse dù inactive. A04 cập nhật Catalog availability/Cart/Pricing validation và regression cùng schema, không chỉ admin flag. Actual code/schema giữ B05 stock availability cho đến khi A04 được giao/implement.

## 9. Size/Topping management policy

Size là ProductSize PK(productId,size), **S/M/L only**, không global Size entity/custom label. Admin thêm/sửa phụ thu, read và remove association an toàn. Rename size PK không hỗ trợ; create/delete riêng. Giá >=0 Decimal; mọi size dùng Product.stock, không size/topping stock. Topping là entity global name/price; ProductTopping PK xác định tập hợp lệ, không cascade delete.

ProductSize delete bị chặn nếu CartItem(productId,size) reference, nếu last size, hoặc OrderItem cùng product/size lịch sử (service guard dù không FK snapshot→size). Topping entity delete bị chặn bởi ProductTopping, CartItemTopping hoặc OrderItemTopping FK. Remove ProductTopping bị chặn nếu Cart/Order snapshot cùng product+topping sử dụng (service guard vì không FK Cart→association); không âm thầm biến Cart thành cấu hình lỗi. Transaction lock parent Product và kiểm tra reference; race association selection phải serialize/guard trong A05 (parent lock hoặc shared version guard ở Cart write), FK vẫn defense cho entity. Không xóa history để giải phóng FK.

Global Topping edits dùng topping expectedVersion, không bump mọi Product.version. Price/name mới chỉ ảnh hưởng read/Cart/create tương lai; Order snapshot và Payment retry giữ nguyên. Concurrent Order có thể snapshot cấu hình hợp lệ ở thời điểm B09 DB read; không hứa commit-time repricing. Existing engines chỉ mở rộng validation/serialization cần thiết, không thay công thức.

**AD02 APPROVED — ACCEPTED USER, 2026-10-11; PLANNED A05:** `ProductSize.isActive Boolean @default(true)` điều khiển size của product tương ứng; `Topping.isActive Boolean @default(true)` điều khiển topping toàn hệ thống; existing ProductSize/Topping backfill active. Không xóa Cart/history khi ngừng cung cấp option; Order snapshot/Payment retry giữ nguyên, không reprice. Checkout mới đọc/validate trạng thái Product/size/selected Toppings hiện tại trong B09/B10 transaction, không tin Cart cache.

Public detail chỉ option active; Cart có retired/không còn hợp lệ option vẫn giữ dòng với available=false và thông báo rõ để người dùng điều chỉnh hoặc xóa. Cart GET cần đọc trạng thái options hiện tại, không tự cleanup Cart; add/PATCH/new create chặn400 INVALID_ITEM_OPTIONS. Có thể dùng message “Sản phẩm hoặc tùy chọn không còn được bán; hãy điều chỉnh giỏ hàng” cùng available hiện có, không cần thêm customer DTO field. Stock không đổi. Active Product cần ít nhất một active size: retire last active size409 RESOURCE_IN_USE, hoặc retire Product trước theo AD01. Không last-size rule cho topping (không topping là valid). Existing Order/Payment retry/B16 snapshot vẫn giữ.

**ProductTopping issue recorded, không schema change:** Topping.isActive là global, không thể retire riêng một product+topping bằng flag này. ProductTopping association management hiện đã planned với reference guards; không thêm isActive/field/migration trên ProductTopping. Nếu cần lifecycle per-product topping vượt association contract, ghi backlog vấn đề và chờ approval riêng cho thay đổi tương ứng; không blocker cho AD02/A01 đã chốt.

## 10. Inventory adjustment/idempotency — proposal tối thiểu PLANNED A06

ADMIN only. Stock theo Product, không nguyên liệu/warehouse/ledger. POST `/admin/products/:id/inventory-adjustments`, `Idempotency-Key` bắt buộc1..128 visible ASCII theo helper hiện có, body **chỉ** `{delta,expectedVersion}`. delta số nguyên khác0 trong -2147483647..2147483647; phép cộng checked trước write, stock kết quả0..2147483647. Không nhận absolute stock/reason/operatorId/total; không bypass lifecycle. Positive/negative adjustment tác động **stock khả dụng hiện tại**, không chỉnh reservation consumption đã trừ; ví dụ stock5→delta-3=2, unpaid cancel sau đó vẫn hoàn đúng qty snapshot.

Scope key `(authenticatedAdminId, ADJUST_INVENTORY, key)`, request hash gồm operation+productId+delta+expectedVersion, canonical DTO; không current stock/time/JWT. Cùng admin/key đổi product hoặc delta/version409 IDEMPOTENCY_KEY_REUSED; hai admin key giống nhau scope độc lập nhưng race Product CAS. Không dùng CREATE_ORDER/PAY_ORDER namespace.

Tái sử dụng bảng15-model hiện có `idempotency_requests`, không inventory ledger hay bảng adjustment. Schema hiện có enum chỉ CREATE_ORDER/PAY_ORDER và SQL `idempotency_result_check` bắt COMPLETED order_id NOT NULL; vì vậy A06 **phải** có migration additive enum/CHECK, không gắn order giả. Proposed CHECK:

```sql
CHECK (
  (state = 'PROCESSING' AND order_id IS NULL
    AND response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
  OR
  (state = 'COMPLETED' AND response_status IS NOT NULL
    AND response_body IS NOT NULL AND completed_at IS NOT NULL
    AND (
      (operation IN ('CREATE_ORDER', 'PAY_ORDER') AND order_id IS NOT NULL)
      OR (operation = 'ADJUST_INVENTORY' AND order_id IS NULL)
    ))
)
```

Giữ response_status CHECK100..599/UQ/FK cũ; giữ completion order_id bắt buộc cho hai operation gốc. Product ID và committed result lưu hash/body, không product FK/cột ledger mới. PostgreSQL18 enum ADD VALUE dùng trong transaction chỉ sau commit; A06 tách commit thêm enum trước migration thay CHECK dùng giá trị đó, review cả hai trước apply. [PostgreSQL18 ALTER TYPE](https://www.postgresql.org/docs/18/sql-altertype.html). Không sửa migrations đã apply; không chạy SQL trong A00.

Flow: JWT+DB ADMIN authorize → syntax/key → transaction completed replay lookup trước Product lookup/version/business validation → lock user **admin** trước FK claim insert theo helper pattern → reread claim → insert PROCESSING → Product read → expectedVersion match → checked delta → CAS `{id,version}` stock increment delta/version+1/updatedAt → save200 result/COMPLETED(orderId=null) → commit. Đây là transaction riêng của adjustment, không lock customer user row nên không lock inversion với B10/B11/B16; Product CAS phân xử customer/operator races. Claim, stock và replay result rollback/commit cùng nhau. No standalone PROCESSING commit/no auto retry.

Cùng key/payload đã commit trả exact status/body và `Idempotency-Replayed:true` dù Product.version/stock sau đó đổi hoặc Product đã delete; auth/DB role vẫn được kiểm tra **trước replay**. Replay là lịch sử, GET inventory/AdminProduct lấy tồn hiện tại. Same-key concurrent unique loser rollback, recovery read một lần transaction mới; chưa result409 IDEMPOTENCY_IN_PROGRESS. Business validation/CAS/technical errors rollback claim; 409 CONCURRENT_UPDATE hoặc INVALID_STOCK_ADJUSTMENT,503 technical. Chưa chắc response: retry nguyên key/payload, không key mới/expectedVersion mới. Known rollback conflict: GET current stock rồi **người dùng xác nhận thao tác mới**, key mới/version mới; không tự resubmit delta có thể double-add. Context user/product/key/payload lưu sessionStorage như B10/B11, không JWT; switch account clear/disallow replay context cũ. No TTL cleanup claims ở demo.

Replay retention trong bảng idempotency chỉ chống duplicate; không được quảng cáo là stock ledger/report/audit feature. B10/B11/B16 effects, held stock và paid-cancel restock giữ nguyên. Khi version max,503 rollback; stock overflow409; không clamp stock về0.

## 11. Promotion management policy

ADMIN only A07. Chỉ FIXED AMOUNT; một promotion/Order, không percentage/stack/quota/coupon engine. Promotion code normalize trim/uppercase1..32, UQ; **code immutable** sau create tránh đổi ý nghĩa code được hiển thị. discountAmount integer money>0; minimumSubtotal>=0; endsAt>startsAt; isActive boolean explicit create. PATCH validate **merged** record, không chỉ các field gửi. isActive=false là ngừng áp cho Order mới, không xóa history.

Add Promotion.version default/backfill0/check>=0 ở A07; PATCH/DELETE require expectedVersion, CAS+increment+updatedAt atomically; stale concurrent admin edit/delete409 CONCURRENT_UPDATE, unique create race409 PROMOTION_CODE_EXISTS. DELETE chỉ khi không Order reference, bao gồm unpaid/failed/cancelled/history; FK Restrict/P2003 race409 RESOURCE_IN_USE, không SET NULL/cascade. Referenced Promotion có thể sửa cấu hình/disable; snapshot Order và Payment retry/replay không đổi.

Concurrency với create Order: thời điểm eligibility/snapshot là read Promotion trong B09 transaction theo B10/B13 hiện hành. Order đã đọc bản hợp lệ có thể commit snapshot cũ nếu admin edit/disable sau read; edit không revoke/reprice snapshot. Request đọc sau committed edit dùng config mới, active/start-inclusive/end-exclusive/minimum-inclusive. Nếu delete cạnh tranh Order referencing, FK phân xử: Order đã có reference thì delete409; nếu delete thắng trước validation/insert, Order reject/rollback (PROMOTION_INVALID khi B09 không thấy hoặc CONCURRENT_UPDATE khi FK race), stock/claim/Order không commit một phần. A07 phải map race sanitation và verify thực tế; không thêm transaction retry hoặc sửa Payment service snapshot rules.

Price/discount changes khi Order PENDING/PAYMENT_FAILED/PAID không reprice; Payment retry dùng `Order.total` snapshot, không kiểm tra Promotion.version/current eligibility. Không endpoint direct discount Order hay price recalculation của admin. Management reads/list không tác động promotion eligibility/timestamps.

## 12. Admin/Staff frontend routes — PLANNED

| Route | Role | Task / chức năng |
| --- | --- | --- |
| /login | All roles | B07 form chung, A01 response role/navigation; không /admin/register |
| /operator/orders | STAFF, ADMIN | A02 list/filter/Refresh IMPLEMENTED, không realtime/report |
| /operator/orders/[id] | STAFF, ADMIN | A02 snapshot/current revision +A03 explicit preparation controls/ADMIN cancel confirmation IMPLEMENTED |
| /admin/products | ADMIN | A01 admin shell IMPLEMENTED; A04 list/CRUD/active toggle PLANNED theo AD01 APPROVED |
| /admin/products/[id]/options | ADMIN | A05 S/M/L prices/association/active toggle theo AD02 APPROVED |
| /admin/toppings | ADMIN | A05 global Topping management |
| /admin/inventory | ADMIN | A06 stock/version và explicit delta adjustment/result/recovery |
| /admin/promotions | ADMIN | A07 list/create/edit/disable/safe delete |

Không cần /admin dashboard landing hoặc /staff duplicate UI. Login safe local returnTo giữ B07; không returnTo thì CUSTOMER về `/`, STAFF/ADMIN về `/operator/orders`; incompatible role route hiển thị access denied, không redirect loop. Reload login lại, state memory; login role chỉ UX routing. Customer routes/UI hiện có giữ đúng luồng, không full redesign.

Protected operator views fresh GET/private no-store; loading/empty/error/Retry/manual Refresh, responsive390/768/1366, keyboard focus/labels/busy. 401 clear current session,403 clear protected data/show denied. Late response của account/role/route trước phải discard theo B15. Actions chỉ explicit click, disable trong flight; conflict reload/display current state và cần xác nhận bước mới. ADMIN paid-cancel có confirm stock/points reversal và **không hoàn tiền**; Staff không có nút đó và direct HTTP vẫn403. Không POST để fetch/probe/render page. Inventory transport retry giữ context/key như §10; không optimistic stock update.

## 13. Security/provisioning

B07 HS256/sub/iat/exp/3600s, secret env, bcrypt10, password8..72 UTF-8 bytes/no trim, email trim/lowercase<=254 giữ nguyên; token memory/no refresh/reset/session DB. A01 DB role lookup mỗi protected request bằng existing JwtStrategy/UsersService, RolesGuard deny-by-default. Public register reject role và mọi field dư, luôn CUSTOMER; login mọi role dùng cùng auth. Fabricated signed role claim cũng không bypass DB role. CORS/UI hiding không thay authorization.

A01 extend public user projection của UsersService/JwtStrategy với role DB, không passwordHash. Protected customer controllers require CUSTOMER metadata; future operator controllers STAFF/ADMIN, admin controllers ADMIN. JwtAuthGuard chạy trước RolesGuard; RolesGuard chỉ đọc verified req.user.role và allowlist metadata, thiếu/unknown metadata hoặc unknown role fail403, không allow-all fallback. Public health/Catalog/register/login giữ public, không áp RolesGuard deny-by-default vào public routes. Verification-only guard tests có missing-metadata probe, không production bypass/role-management endpoint.

CLI **IMPLEMENTED A01**, command `npm run provision:operator --workspace backend -- --role ADMIN` hoặc STAFF; [source/tests/evidence](A01_RBAC_AUTH_CONTRACT.md). Chạy thủ công create-only, role arg chỉ ADMIN/STAFF; không promote/demote/reset tài khoản có sẵn. Email/password nhập interactive; password hidden + confirmation, không CLI arg/env/command history; reject non-interactive credential input. Hash B07; transaction insert new normalized unique user/role, loyalty0, no Cart/Orders. Duplicate email/collision/concurrent CLI fail nonzero giữ password/role/points cũ, không upsert. Failure không log raw Prisma error hoặc DSN/credentials.

Environment gate tối thiểu: NODE_ENV=development, explicit `ALLOW_OPERATOR_PROVISIONING=true`, DB host loopback local và tên `_dev` hoặc `_test`; demo dùng development allowlist. Fail closed mọi môi trường khác/thiếu gate; không tự nối remote/prod. Printed result chỉ user ID/role và sanitized status, không email/password/hash/JWT/connection URL. Secrets entered never file/log; clear references khi xong/abort/interrupt. Không tự provision khi seed/startup/migration; không demo password hardcode/README thật; không public Admin/Staff registration hoặc role-management endpoint/UI.

Role đổi trong DB có hiệu lực request kế tiếp với JWT còn hạn; không claim atomic revocation giữa request đã authorize và commit (same-request changes vẫn theo transaction hiện có). Scope chưa có account-role management/revocation engine. A01 phải document limitation logout local/JWT còn valid tới exp của B07, không mở rộng session system.

## 14. Acceptance tests — PLANNED, chưa chạy

| ID / task | Kết quả phải chứng minh |
| --- | --- |
| AS-T01 / A01 | Isolated migration existing users CUSTOMER/no NULL; new register CUSTOMER; role injection400; no lost existing rows/relations |
| AS-T02 / A01 | Protected customer endpoints + operator/admin verification-only guard probes: no JWT401, wrong DB role403 before lookup/replay; missing role metadata/unknown role403; fake JWT/header/body role không nâng quyền; DB demotion cùng token request kế tiếp403; public health/Catalog/auth unchanged; future live matrix A02–A07 |
| AS-T03 / A01 | Auth HS256/TTL/password/normalization/duplicate giữ B07; login/register role field đúng; customer ownership/cross-owner404/paid-cancel409 regression |
| AS-T04 / A01 | CLI gates/create ADMIN+STAFF/bcrypt10; repeat/existing email/concurrent fail without promotion/password overwrite; no secrets logs/history; seed/startup không tạo operator |
| AS-T05 / A02 | List all owners/status filter/sort/empty; exact projections/status-version same read, no PII; DB fingerprints reads unchanged; CUSTOMER403 |
| AS-T06 / A03 | STAFF/ADMIN exact PAID→PREPARING→READY→COMPLETED; skipped/terminal/invalid/unpaid rejected; expectedVersion stale/CAS races/timeout409, no auto advance on lost response |
| AS-T07 / A03 | ADMIN-only paid cancel restores aggregated qty/reverses original12 points/zero marker exactly once; repeat/concurrent/prepare-vs-cancel, Payment replay historical, preserved snapshots/Payment/paidAt/Cart; no refund; STAFF403 even CANCELLED |
| AS-T08 / A03 | Fault after each B16 write rollback all; cancellation/retry/order create races; reuse existing graph49-pair/stock/award tests, không bỏ baseline cases |
| AS-T09 / A04 | Product CRU exact money/options; stock/version rejected body; OCC vs stock/create; delete no-consumer Product cleanup options atomically, last-size endpoint guard không gây dead-end; references/Cart/history/FK race409; no snapshot reprice; create timeout no automatic duplicate |
| AS-T10 / A05 | S/M/L only/unique/parent version/last size; Topping own OCC; association cart-selection race serialization; references/Cart/history delete blocked, no cascade; old snapshots/Payment retry unchanged |
| AS-T11 / A06 | Delta positive/negative/zero/non-int/bounds, no negative/clamp; stock/version bump once; current GET vs historical replay; same-key sequential/concurrent/lost-response exact once; different payload/product/version409 |
| AS-T12 / A06 | Two-admin/customer/B16 restock races OCC no lost update; fault stock/claim completion rollback; unauthorized replay403; same key independent CREATE_ORDER/PAY_ORDER; revised CHECK preserves old ops and inventory orderId null only |
| AS-T13 / A07 | Fixed>0/money/minimum/date/boolean/immutable code/duplicate UQ; promotion edit/delete OCC; referenced delete409/disable allowed; create-vs-edit/delete snapshot boundary+rollback; Payment retry no reprice |
| AS-T14 / A02–A07 | Real browser FE→BE→PostgreSQL operator UI; permission direct API, loading/empty/error/Retry,401/403/switch/late response/keyboard/responsive; customer B06–B16 regression; no secret evidence |
| AS-T15 / A04–A05 AD01/AD02 APPROVED | Active stock>0/stock0/inactive stock>0; toggle stock unchanged; public hiding/options, stale Cart giữ dòng+message, new checkout validates current flags; last active size; snapshot/history/Payment retry/replay/B16 restore unchanged; existing flags backfill true/new default true, no delete/reset/applied-migration edits |

Use existing lint/build/test tooling; PostgreSQL concurrency/migration/FK/rollback dùng UUID schema riêng, không mutate/reset public/dev history. Implement task được giao mới chạy appropriate checks + regression bị ảnh hưởng; A00 chỉ local links/anchors, JSON examples, mapping/contract consistency, diff/whitespace, hashes/file scope. Existing B16 counts là historical evidence, không A00 execution. Human/team DoD/Firefox/NFR01/B17 không được đánh dấu hoàn thành từ A00.

## 15. Dependencies và readiness A01–A07

| Task | Dependency / acceptance boundary | Trạng thái |
| --- | --- | --- |
| A00 | User scope + baseline/source audit, contract16 sections/docs consistency/local commit | Documentation complete; lifecycle approvals tracked §16 |
| A01 | A00 role/RBAC/auth/CLI contract + B07; không phụ thuộc lifecycle flags | IMPLEMENTED/technical RBAC READY; [159/103/278 tests + Edge evidence](A01_RBAC_AUTH_CONTRACT.md) |
| A02 | A01 guards/role hint + B15 read projection | IMPLEMENTED read UI/API only; verification tại [A02](A02_OPERATOR_ORDER_MANAGEMENT_CONTRACT.md), no A03 actions |
| A03 | A01/A02 + B16 command/B10/B11 lifecycle | IMPLEMENTED workflow/admin cancellation; validation tại [A03](A03_STAFF_WORKFLOW_CONTRACT.md), không rewrite engines |
| A04 | A01+B05/B09; A06 only for topup, not CRU stock0 | IMPLEMENTED CRUD/lifecycle/delete AD01/D39,277/145/336+Edge at A04; A05–A07 PLANNED |
| A05 | A01/A04+B05/B08/B09; migration Topping.version + parent OCC | PLANNED management/lifecycle; AD02 APPROVED, không implementation A00/A01 |
| A06 | A01/A04+B10/B11/B16+idempotency enum/CHECK plan | PLANNED delta/OCC/replay; không cần inventory ledger hoặc A03 UI đã xong |
| A07 | A01+B13/B09/B10/B11 + Promotion.version plan | PLANNED; độc lập A05/A06/A03 UI |
| A08/A09 | Separate explicit user approval | NOT APPROVED, không implementation checklist |

A00 roadmap approval ban đầu chỉ design. Người dùng đã giao A01 riêng và [A01](A01_RBAC_AUTH_CONTRACT.md) đã implement UserRole/default/backfill, guards/auth response/CLI/shell/security/customer regression; không lifecycle/inventory/promotion migration hoặc B17/redesign. Recommended next task: **A02 — Operator Order Management UI**, chỉ khi được giao riêng; A02–A07 vẫn PLANNED.

## 16. Open decisions requiring approval và kết luận

| ID | Final user decision / ngày | Migration/application boundary |
| --- | --- | --- |
| AD01 | **APPROVED / ACCEPTED USER, 2026-10-11:** Product.isActive default/backfill true; semantics §8 | PLANNED A04, không A00/A01 |
| AD02 | **APPROVED / ACCEPTED USER, 2026-10-11:** ProductSize.isActive/Topping.isActive default/backfill true; semantics §9 | PLANNED A05, không ProductTopping field/migration |

**Remaining open decisions A00/A01: 0.** Trạng thái NEEDS DECISIONS tại checkpoint d75457d được superseded bằng xác nhận người dùng/D37, không dùng recommended option làm approval. ProductTopping per-product lifecycle issue ở §9 chỉ là giới hạn được ghi nhận, không yêu cầu/approved schema hoặc blocker. A08/A09 vẫn NOT APPROVED; không chờ quyết định ngoài scope để bắt đầu A01 khi được giao.

| A01 readiness item | Contract / evidence thiết kế |
| --- | --- |
| CUSTOMER/STAFF/ADMIN | §3 permission matrix, §4 UserRole; no impersonation/direct Payment/Loyalty editing |
| Role migration | §4 native enum/default/backfill CUSTOMER, additive/no reset; lifecycle A04/A05 riêng |
| Auth response | §6 AuthUser role ở register/login; JWT sub/iat/exp/memory/HS2563600s giữ B07 |
| RolesGuard | §3/13 DB role mỗi request, deny-by-default, JWT guard trước RolesGuard; wrong-role403 trước resource/replay; explicit role metadata trên protected controllers/routes |
| Operator provisioning CLI | §13 create-only/manual ADMIN hoặc STAFF, hidden credentials/hash B07/local opt-in gates, không seed/startup/upsert promotion |
| Permission matrix | §3/5 namespaces customer/operator/admin; không role từ JWT claim/body/header làm authority |
| Security tests | §14 AS-T01–04: migration/auth/injection/fake claims/role change/CLI secrecy/customer regression |

A01 kiểm chứng role guards cho operator/admin future permissions qua verification-only test harness; chưa expose A02/A03/management endpoints chỉ để test guard. A02–A07 mới verify live endpoint matrix khi được giao; A01 không đánh dấu chúng IMPLEMENTED hoặc tự tạo production bypass route.

**ADMIN CONTRACT READY. A01 IMPLEMENTED / RBAC READY (technical user scope)** theo task development riêng; evidence tại [A01](A01_RBAC_AUTH_CONTRACT.md). A00 finalization trước đó chỉ documentation; A02–A07 business APIs/UI và remaining schema vẫn PLANNED, không suy ra implementation từ design.
