# BrewLite — Ma trận truy vết

O01 user extension 2026-11-15 → [contract hủy/theo dõi](O01_CANCEL_TRACKING.md), FR09/10/11/12/13/14/16, NFR02/05. Cancellation-window/OrderService/controller, tracking/refund/support migration và UI Customer/Staff/Admin; kiểm tra deadline, quyền, concurrent cancel/prepare, refund evidence/replay và bảo toàn nguyên liệu. Mở paid-cancel cho Customer và quy trình refund theo yêu cầu đã chọn, không thêm FR PDF.

I08 user extension2026-11-13 → [hai quy định và ngoại lệ đã chốt](I08_INVENTORY_CONTROL.md), I01/I07/FR01/02/06/11–14/NFR02: inventory-control policy, IngredientService/DTO/controller, snapshot/sequence migration, Catalog sizeAvailability, inventoryRecipeForDrink/12 nguyên liệu không nước, frontend kiểm kê/config/cảnh báo và unit/HTTP/PostgreSQL/browser. Không tính chênh lệch đá/vật dụng, không trung bình/dự phòng hoặc mang đi; không thêm FR PDF, không suy hoàn tất từ thiết kế.

A05/FR02/FR03/FR06, AS-T10/14/15 → [Topping repair2026-11-13](A05_SIZE_TOPPING_MANAGEMENT_CONTRACT.md): frontend `admin-options.ts` parser/transport/message và useManagement read/write; backend ToppingParamsDto/controller và AdminOptionService native UUID/TEXT row read/lock. HTTP `admin-options.spec.ts`, frontend `admin-options.test.mjs`, PostgreSQL `topping-storage.spec.ts` và Edge live kiểm tra danh sách/edit/F5/GET recovery. Không schema/PDF requirement mới; quyền/CAS/reference guard giữ nguyên.

A04/FR01/FR02 và AS-T14 → [sửa lỗi đọc sản phẩm2026-11-13](A04_ADMIN_PRODUCT_MANAGEMENT_CONTRACT.md): parser reference topping trong `lib/api/products.ts`/`admin-products.ts`, message GET trong AdminProducts; tests `admin-products.test.mjs`/`catalog.test.mjs` tái hiện7 món có topping ID số, từ chối ID sai và giữ Product UUID guard/no-resend write. Browser GET error assertion trong `products-browser.mjs` đồng bộ message mới. Không schema/PDF requirement mới hoặc thay quyền/input mutation.

I07 user extension2026-11-12–13 → [contract](I07_SIZE_RECIPE_CONSUMPTION.md),3 file công thức và danh mục mới đã chọn; drink-recipes/product-ingredients, Cart/Pricing/Order, order-ingredients snapshot/journal và payment hooks, migration/runner, Catalog size/topping và kho physical/reserved/available. UI amendment2026-11-15 bỏ cột “Đã giữ” trong IngredientTable, vẫn hiển thị tồn thực tế/có thể bán và giữ cơ chế reservation; cập nhật ingredients.test.mjs và size-recipes-browser.mjs theo giao diện mới. Kiểm chứng: unit recipe/core inventory, PostgreSQL size-recipes UUID/TEXT cùng hồi quy I05/I01, frontend contract/render và browser local; kết quả đợt bỏ cột tại [checklist](DEVELOPMENT_PLAN.md). Tái sử dụng FR01/02/03/06/08/11/12/13/14, NFR02 và I01–I06; không thêm yêu cầu PDF hoặc tự triển khai mọi đề xuất từ file kịch bản.

I01/I03–I06 → [sửa lỗi kho localhost2026-11-12](LOCAL_INVENTORY_REPAIR.md): IngredientService raw ID comparisons và phân loại SQL errors; `ingredient-errors.spec.ts`, database `ingredient-storage.spec.ts` (UUID/TEXT), hồi quy `ingredients.spec.ts` và browser hai trang. Giữ mapping requirement cũ, quyền/khóa/CAS/replay/ngưỡng và dữ liệu; không thêm requirement PDF.

FR01/FR04/FR05/NFR05 và B03/B06/B07/A01/UI01 → [auth/catalog repair2026-11-12](LOCAL_AUTH_CATALOG_REPAIR.md): common record-id, SessionService/JwtStrategy, AuthSession public/private gates, GET Order DTO/parsers, seed7 món local-only; regression session-id/auth-session/operator-orders/catalog, PostgreSQL local và browser role reloads. Không thêm requirement PDF; không suy ra nghiệm thu Order mutations/VNPAY từ sửa auth.

I06 user extension2026-11-07 → [contract/acceptance](I06_INGREDIENT_WARNING_THRESHOLDS.md), catalog lowStockThreshold, ingredient-policy/service/list/summary, migration/check và frontend warning metadata/table. Tests: policy/catalog, database ingredients + ingredient-warning-migration + I05 regression, frontend ingredients/browser. Không thêm FR PDF, đổi tên/đơn vị/lượng tồn hoặc mapping I05.

I05 user extension2026-11-07 → [contract/acceptance](I05_PRODUCT_INGREDIENT_AVAILABILITY.md), product-ingredients.ts, OrderItem snapshot/migration, Catalog/Admin/Cart/Pricing/create/initiation/IPN/zero; unit product-ingredients, database product-ingredients/catalog, frontend Admin inventory/products tests và ingredients-browser. Tái sử dụng FR01/02/03/06/08/13/14, NFR02 và A06; semantics Product.stock của đơn cũ giữ nguyên,7 món mới theo quyết định user. Không thêm/bỏ FR PDF.

I04 BAG bổ sung2026-11-07: Bột quế KG, Đá BAG; người dùng xác nhận cảnh báo dưới5 bao. DTO/policy/migration BAG và frontend unit labels/forms, backend unit/database và frontend ingredients tests truy về [contract](I04_INVENTORY_CATALOG_REFRESH.md); không thêm FR PDF.

I04 user extension 2026-11-07 (không FR PDF mới):9 nguyên liệu/5 vật dụng và chai cảnh báo dưới10 → [contract/acceptance](I04_INVENTORY_CATALOG_REFRESH.md), `ingredient-catalog.ts`, Prisma BOTTLE/migration, ingredient policy/DTO/service, frontend types/API/forms; backend catalog/policy/database tests và frontend ingredients/browser tests. Tái sử dụng NFR02, FR13–14 như I03, không đổi mapping PDF.

**Cart preservation fix 2026-11-02 — FR08:** Người dùng yêu cầu sửa lỗi mất giỏ khi thanh toán thất bại. `POST /orders` giữ nguyên Cart thay vì xóa khi tạo PENDING; settlement tiếp tục không sửa Cart, bao gồm failure/retry/success và callback lặp. Không thay schema, API/DTO, quyền, idempotency hoặc tồn kho. Thay đổi này supersede quy tắc consume-Cart-at-create của amendment 2026-10-22; các mô tả clear/consume cũ bên dưới là lịch sử. Tests: `cart-payment-preservation.spec.ts`, cập nhật database orders/checkout-lifecycle; xem [chi tiết](CART_FAILURE_FIX.md).

I03 amendment2026-10-31 (yêu cầu quản lý danh mục trong một file) → `ingredient-catalog.ts`/IngredientService read+initialize, GET DTO `isListed`/`displayName`, frontend ingredient helpers/table/forms/summary. `backend/test/ingredient-catalog.spec.ts` và `frontend/test/ingredients.test.mjs` kiểm tra thêm/bỏ/thêm lại/label, giữ tồn/ID, cấu hình sai/rỗng, kiểm kê lại hàng đã bỏ và thống kê UI. [Contract/acceptance](I03_RECEIVING_CATALOG.md), [API](API_DESIGN.md); giữ schema và mapping PDF gốc. Evidence đợt I03 ban đầu bên dưới không thay cho kiểm chứng amendment mới.

I03 user amendment2026-10-29 → [contract](I03_RECEIVING_CATALOG.md), ingredient-catalog/controller/service, enum/check migration, frontend types/helpers/forms/load. Policy/database/frontend/browser tests xác minh12 mặt hàng, tạo thiếu không overwrite/duplicate, quyền, số nguyên quả, ngưỡng10, receipt→count→approve→reload. Giữ mapping I01/I02 và nghiệp vụ tài chính.

I02 user amendment2026-10-29 → [contract](I02_INVENTORY_CATEGORIES.md), IngredientPolicy/Service/DTO, migration ngưỡng, UI kho/nhập hàng/operator shell. Backend policy/database tests kiểm tra ba đơn vị tại0/dưới/bằng/trên ngưỡng, DB CHECK, old replay và quyền; frontend unit + browser kiểm tra đúng6 menu,2 nhóm kho,3 lựa chọn nhập, nhập bổ sung và lịch sử thật. Truy vết I01/NFR02/FR13–14 không đổi nghiệp vụ tài chính.

I01 user extension2026-10-29 (không FR PDF mới): quản lý nguyên liệu/nhập hàng/kiểm kê/duyệt/audit → [contract](I01_INGREDIENT_INVENTORY_CONTRACT.md), backend IngredientModule +6 models/migration, routes UI Admin/Staff, `backend/test/database/ingredients.spec.ts`, `backend/test/ingredient-policy.spec.ts`, `frontend/test/ingredients.test.mjs`, `frontend/test/ingredients-browser.mjs`. Lỗi tải dữ liệu/empty/timeout/thống kê/reload và rollout database thật truy vết tại [báo cáo](I01_INGREDIENT_INVENTORY_IMPLEMENTATION.md). Truy vết an toàn liên quan NFR02/current-role guards, FR13/idempotency và FR14/transaction/version như kỹ thuật tái sử dụng; không thay nghiệp vụ Product/Order/Payment hoặc mapping gốc. Kết quả nghiệm thu cập nhật ở [plan](DEVELOPMENT_PLAN.md).

| Amendment user2026-10-22 | Requirement liên quan | Source / evidence |
| --- | --- | --- |
| Deadline600s, safe expiry/IPN recovery | FR06–14/16 | orders/payment-expiration.worker.ts; payments/attempt.service.ts, payment-receipt.worker.ts, ipn.service.ts; checkout-lifecycle integration |
| Independent Cart, guarded checkout | FR03/06/08/13–14 | cart.service.ts; order.service.ts; `/cart`, `/checkout`, pending-order; checkout-lifecycle + Edge isolated browser |
| Persistent3-role session | FR05/NFR02/05 | auth/session.service.ts, jwt.strategy.ts; Next auth proxy, auth-session; auth-session.test.mjs + checkout-lifecycle + Edge3-role reload |

[Amendment và giới hạn nghiệm thu](CHECKOUT_SESSION_UPDATE.md); không thay PDF.

FR05/06/08/11–14, NFR02/05 — Order controller/service review2026-10-27: `backend/test/order-history.spec.ts` kiểm tra `/orders/active` JWT/current role, owner, empty input, no-store và lỗi DB503; `backend/test/database/orders.spec.ts` chứng minh cross-owner cancel404 kể cả Order đang bị khóa; `backend/test/order-service.spec.ts` kiểm tra expiration trả marker đã lưu, giữ reservations khi gateway pending. Controller/API paths/DTO/quyền không mở rộng; [error clarification](API_DESIGN.md) và [technical decision](DECISIONS.md).

FR06/08/13–14, B09/B10 snapshot regression2026-10-26 → `backend/src/orders/order.service.ts` và `backend/test/database/orders.spec.ts`: ghi Order/Item/Topping theo lô trong cùng transaction; kiểm tra50 cấu hình với đúng topping/giá snapshot và rollback parent/stock/claim khi insert topping lỗi, cùng key retry không trùng. Không thay DTO/bounds hoặc protocol đo NFR01.

Regression fixes2026-10-26: FR05/NFR02 → `backend/test/auth-session.spec.ts` (malformed UUID/401/logout); FR06–14/NFR05 → `frontend/test/checkout-recovery.test.mjs`, checkout/gateway fixtures (timeout, terminal/uncertain context, retry URL); FR06–14/16 → `backend/test/payment-workers.spec.ts` (51 rows, timestamp ties, processed anchor, scan failure/wrap); A04–A06/NFR04 → `backend/test/admin-transaction-policy.spec.ts` (Neon round trip >400ms); B03/B19/P01 → `scripts/test/dev-runtime.test.cjs` (failed startup/recover/UI/admission/stop guards); NFR04/08 setup → `frontend/test/env.test.mjs` (một root env, public-only config/shell override). Mapping requirement không đổi; lựa chọn bỏ env template ghi ở REQUIREMENTS/DECISIONS. Các fixtures không thay financial integration hoặc browser acceptance.

PDF [BrewLite-CongNghePhanMem.pdf](BrewLite-CongNghePhanMem.pdf) là baseline; FR/NFR/BR tại [Requirements](REQUIREMENTS.md). “Có source/tests” nghĩa có hiện thực để review, không phải full DoD hoặc đã đạt mọi NFR. Không tạo FR mới từ extension.

## 1. Functional requirements

| FR | Thiết kế / backlog | Source hiện hành | Kiểm chứng liên quan |
| --- | --- | --- | --- |
| FR01–02 | B04–B06, [catalog](B05_CATALOG_CONTRACT.md), B09 | backend/src/catalog, backend/src/pricing; frontend products/catalog UI | Backend catalog/pricing tests; frontend catalog tests |
| FR03 | B08/D29, [Cart](B08_CART_CONTRACT.md) | backend/src/cart; frontend Cart/API/store | Cart unit/HTTP/database và frontend cart tests |
| FR04–05 | B07/D19, [auth](B07_AUTH_CONTRACT.md) | backend/src/auth/users; frontend login/register/auth | Auth/JWT/roles/ownership tests |
| FR06/08 | B09–B10/D31, [Order](B10_ORDER_CONTRACT.md) | backend/src/pricing/orders; frontend order-checkout | Pricing/orders/checkout và database concurrency tests |
| FR07/09 | P00/P01, [VNPAY contract](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md) | backend/src/payments (Attempt/IPN/Return/zero); frontend gateway-checkout, payment-result | VNPAY initiation/IPN/Return/zero/config tests; Mock payment đã loại bỏ |
| FR10 | B15, [history](B15_ORDER_HISTORY_CONTRACT.md) | Order owned read APIs; frontend orders | History/cursor/ownership tests |
| FR11–12 | B16/DR14–15, [workflow](B16_ORDER_WORKFLOW_CONTRACT.md) | order-state/order-policy/order.service; operator/admin controllers | State matrix, transitions, rollback/cancel/reversal tests |
| FR13 | B10–B12/D08–11, [API](API_DESIGN.md) | common/idempotency, Order/Payment/Attempt services, DB unique constraints | Same/cross-key/concurrent replay, mismatch and late callback tests |
| FR14 | Q08–09, [Database](DATABASE_DESIGN.md) | Order/Product CAS, owner/product locks, stock/version | Last-stock multi-user, fault rollback và retry/release tests |
| FR15 | B13/Q10, [promotion](B13_PROMOTION_CONTRACT.md) | PricingService, Promotion schema, Checkout | Promo validity/discount bounds/final total tests |
| FR16 | B14/D32/DR14, [Loyalty](B14_LOYALTY_CONTRACT.md) | LoyaltyAward/User balance; Loyalty service | Award floor/unique/reversal/atomicity tests |

## 2. Extension được owner duyệt

P01/B03/B19 có thêm deployment configuration development với Neon dùng chung, callback owner/member và network transaction deadlines; không thêm FR hoặc đổi schema/API. [Thay đổi, bằng chứng và giới hạn](VNPAY_NEON.md); financial suites chạy database local cô lập, không test-write trên Neon.

| Phạm vi | Thiết kế và implementation | Giới hạn |
| --- | --- | --- |
| A01–A06/UI01 | [A00](A00_ADMIN_STAFF_CONTRACT.md), [role UI](UI01_ROLE_BASED_INTERFACE_CONTRACT.md); auth/catalog/operator/admin controllers và UI | A07 bị hủy; không Campaign/Admin Promotion, A08/A09 chưa duyệt |
| EXT-LR01–03/L01 | [L00](L00_LOYALTY_REDEMPTION_CONTRACT.md), [L01](L01_LOYALTY_REDEMPTION_IMPLEMENTATION.md); loyalty-accounting, journal/cursor/preview/redemption | Không cash refund hoặc tự sửa debt/history; attribution amendment cho gateway |
| VNPAY initiation | [P00](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md), [implementation](P01B2A_VNPAY_INITIATION_IMPLEMENTATION.md); AttemptService và signing/config helpers | Sandbox optional, no production; active/unresolved guards |
| IPN settlement | [T1/T2](P01B2B_VNPAY_IPN_SETTLEMENT_IMPLEMENTATION.md); ipn.service/verification; database fixture tests | Verified evidence + binding trước effects; unique/replay; Return không settle |
| Return/cancel UX | [Return](P01C1_VNPAY_BROWSER_RETURN.md), [Checkout](P01C2_VNPAY_CUSTOMER_CHECKOUT.md); result/cancel notice và read-only failureReason DTO | Không tin Return query; UNKNOWN/REVIEW không giả FAILED; cancelled Order cần intent mới |
| Zero/reconcile | [zero](P01B2C2_ZERO_TOTAL_INTERNAL_CONFIRMATION.md), [QueryDr](P01B2C1_VNPAY_QUERYDR_RECONCILIATION.md) | Explicit zero; external QueryDr OFF, không scheduler/batch/force |
| Normal local runtime | [guide](NORMAL_SANDBOX_MODE.md), scripts/dev-runtime*.cjs, scripts/test/dev-runtime.test.cjs; backend/test/database/sandbox-drain.spec.ts | Independent admission despite UNKNOWN; explicit drain/stop reason and recovery; per-Order guards, late IPN and safe teardown preserved; no one-attempt/30-minute quota |

## 3. Non-functional requirements và bàn giao

| NFR | Cách kiểm chứng / trạng thái |
| --- | --- |
| NFR01 | Protocol từng mẫu <500 ms ở DECISIONS; chưa có báo cáo đo cuối trên môi trường bàn giao |
| NFR02 | JWT/bcrypt/strict DTO/role/ownership/security fixture tests; secrets không thuộc source |
| NFR03 | Browser harness có sẵn; chưa coi Edge/Chromium evidence là đủ Firefox/full matrix |
| NFR04 | Lint/typecheck/build/test commands ở README; phải chạy lại khi thay source, không dùng PASS cũ thay validation |
| NFR05 | Menu/cart/checkout/result loading/empty/error; focused frontend tests |
| NFR06/10 | PostgreSQL integration suites kiểm tra state/idempotency/OCC/rollback/financial invariants trong schema test riêng |
| NFR07 | README/Git workflow/owner review; chưa commit/push trong đợt chuẩn bị |
| NFR08 | Env/examples/scripts hiện có; Docker Compose và clean-clone bàn giao chưa nghiệm thu |
| NFR09 | Next/Nest/REST/PostgreSQL/Prisma thực tế, package/lockfile pinned |

## 4. Kiểm tra chiều ngược

Không thêm nghiệp vụ từ tests, seed hoặc báo cáo Gate. Bảng schema/migration truy về FR13–16 và L00/P00; controller/role DTO truy về API/extension; frontend chỉ hiển thị backend state/capabilities. Các reports cũ còn giữ vì script đọc là REVIEW, không phải requirement/runtime dependency của Normal Mode.

[Plan](DEVELOPMENT_PLAN.md) ghi việc chưa hoàn thành; [Design review](DESIGN_REVIEW.md) phân biệt closure thiết kế và nghiệm thu sản phẩm.

## Cart correction2026-11-02

FR02/03 → atomic options endpoint, qty preservation/merge,50-row boundary: cart service/controller/dto and frontend Cart API/View. FR03/08/14 → aggregate stock warning without reservation; backend Pricing unchanged. FR06/08/15 → successful quote matching Cart/mã/điểm gates new Order intent, saved-request recovery unchanged. AddToCart immediate guard limits repeated clicks; no claim of network retry idempotency. Evidence: cart-service/pricing unit, frontend cart/checkout, native PostgreSQL regression additions pending; see CART_PRICING_FIXES.md. No schema/migration modifications.


## Luồng giỏ đơn giản theo yêu cầu người dùng — 2026-11-02

- Tạo PENDING giữ nguyên Cart, không xóa ở create. Giỏ của owner bị khóa mọi POST/PATCH/options/DELETE khi có PENDING hoặc PAYMENT_FAILED. GET vẫn được phép. Kiểm tra dưới cùng user row lock với create/payment/cancel, không chỉ khóa giao diện. Lỗi409 INVALID_ORDER_STATE kèm existingOrderId hiện có, không endpoint/schema/enum mới.
- PAYMENT_FAILED, UNKNOWN và hủy đơn không xóa giỏ hoặc tự cộng lại món. Khách có thể thử lại thanh toán; muốn đổi món sau lỗi phải hủy đơn cũ, sau đó sửa giỏ/tạo đơn mới. Không tạo đơn thứ hai khi đơn cũ chưa được xử lý.
- Lần thanh toán thành công đầu tiên xóa TOÀN BỘ CartItem của owner, trong cùng transaction với PAID/Payment/điểm. MOCK, VNPAY verified settlement (IPN/QueryDr/receipt worker chung apply) và INTERNAL_ZERO đều dùng helper này. Lỗi cleanup rollback settlement. Replay/callback lặp không xóa giỏ của đơn mới.
- Không giữ phần số lượng thêm hoặc chia Cart A/B. Bỏ ghi metadata `_cartCleanup`, không cần provenance cho đơn mới/cũ. Giữ bộ lọc field nội bộ trên public replay để tương thích receipt đã sinh bởi bản trước. Không thay schema/migration, không backfill hoặc reset dữ liệu.
- Giao diện khóa nút thêm/sửa/xóa trong lúc kiểm tra đơn, khi lỗi kiểm tra và khi có active order; banner dẫn tới tiếp tục thanh toán/hủy. Poll/focus cập nhật trạng thái; trước khi mở khóa sau success/cancel tải lại giỏ. Backend luôn quyết định, kể cả tab khác/cache cũ.
- Các thành viên cần dùng backend mới đồng bộ; một backend phiên bản cũ vẫn có thể cho sửa Cart vì đây là rule ứng dụng, không phải constraint schema.
