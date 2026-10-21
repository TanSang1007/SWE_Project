# BrewLite — Ma trận truy vết

PDF [BrewLite-CongNghePhanMem.pdf](BrewLite-CongNghePhanMem.pdf) là baseline; FR/NFR/BR tại [Requirements](REQUIREMENTS.md). “Có source/tests” nghĩa có hiện thực để review, không phải full DoD hoặc đã đạt mọi NFR. Không tạo FR mới từ extension.

## 1. Functional requirements

| FR | Thiết kế / backlog | Source hiện hành | Kiểm chứng liên quan |
| --- | --- | --- | --- |
| FR01–02 | B04–B06, [catalog](B05_CATALOG_CONTRACT.md), B09 | backend/src/catalog, backend/src/pricing; frontend products/catalog UI | Backend catalog/pricing tests; frontend catalog tests |
| FR03 | B08/D29, [Cart](B08_CART_CONTRACT.md) | backend/src/cart; frontend Cart/API/store | Cart unit/HTTP/database và frontend cart tests |
| FR04–05 | B07/D19, [auth](B07_AUTH_CONTRACT.md) | backend/src/auth/users; frontend login/register/auth | Auth/JWT/roles/ownership tests |
| FR06/08 | B09–B10/D31, [Order](B10_ORDER_CONTRACT.md) | backend/src/pricing/orders; frontend order-checkout | Pricing/orders/checkout và database concurrency tests |
| FR07/09 | B11–B12/B15, [payment](B11_PAYMENT_CONTRACT.md) | backend/src/payments; frontend result/confirmation | Mock payment, checkout/history tests; gateway extension riêng bên dưới |
| FR10 | B15, [history](B15_ORDER_HISTORY_CONTRACT.md) | Order owned read APIs; frontend orders | History/cursor/ownership tests |
| FR11–12 | B16/DR14–15, [workflow](B16_ORDER_WORKFLOW_CONTRACT.md) | order-state/order-policy/order.service; operator/admin controllers | State matrix, transitions, rollback/cancel/reversal tests |
| FR13 | B10–B12/D08–11, [API](API_DESIGN.md) | common/idempotency, Order/Payment/Attempt services, DB unique constraints | Same/cross-key/concurrent replay, mismatch and late callback tests |
| FR14 | Q08–09, [Database](DATABASE_DESIGN.md) | Order/Product CAS, owner/product locks, stock/version | Last-stock multi-user, fault rollback và retry/release tests |
| FR15 | B13/Q10, [promotion](B13_PROMOTION_CONTRACT.md) | PricingService, Promotion schema, Checkout | Promo validity/discount bounds/final total tests |
| FR16 | B14/D32/DR14, [Loyalty](B14_LOYALTY_CONTRACT.md) | LoyaltyAward/User balance; Loyalty service | Award floor/unique/reversal/atomicity tests |

## 2. Extension được owner duyệt

| Phạm vi | Thiết kế và implementation | Giới hạn |
| --- | --- | --- |
| A01–A06/UI01 | [A00](A00_ADMIN_STAFF_CONTRACT.md), [role UI](UI01_ROLE_BASED_INTERFACE_CONTRACT.md); auth/catalog/operator/admin controllers và UI | A07 bị hủy; không Campaign/Admin Promotion, A08/A09 chưa duyệt |
| EXT-LR01–03/L01 | [L00](L00_LOYALTY_REDEMPTION_CONTRACT.md), [L01](L01_LOYALTY_REDEMPTION_IMPLEMENTATION.md); loyalty-accounting, journal/cursor/preview/redemption | Không cash refund hoặc tự sửa debt/history; attribution amendment cho gateway |
| VNPAY initiation | [P00](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md), [implementation](P01B2A_VNPAY_INITIATION_IMPLEMENTATION.md); AttemptService và signing/config helpers | Sandbox optional, no production; active/unresolved guards |
| IPN settlement | [T1/T2](P01B2B_VNPAY_IPN_SETTLEMENT_IMPLEMENTATION.md); ipn.service/verification; database fixture tests | Verified evidence + binding trước effects; unique/replay; Return không settle |
| Return/cancel UX | [Return](P01C1_VNPAY_BROWSER_RETURN.md), [Checkout](P01C2_VNPAY_CUSTOMER_CHECKOUT.md); result/cancel notice và read-only failureReason DTO | Không tin Return query; UNKNOWN/REVIEW không giả FAILED; cancelled Order cần intent mới |
| Zero/reconcile | [zero](P01B2C2_ZERO_TOTAL_INTERNAL_CONFIRMATION.md), [QueryDr](P01B2C1_VNPAY_QUERYDR_RECONCILIATION.md) | Explicit zero; external QueryDr OFF, không scheduler/batch/force |
| Normal local runtime | [guide](NORMAL_SANDBOX_MODE.md), scripts/dev-runtime*.cjs, scripts/test/dev-runtime.test.cjs | No one-attempt/30-minute quota; callback health/drain/shutdown guards vẫn giữ |

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
