# BrewLite — Kế hoạch phát triển và bàn giao

Trạng thái căn cứ source và contract hiện có; checkbox implementation không thay cho toàn bộ nghiệm thu PDF/DoD. Không giữ nhật ký từng lần Gate/FIX trong checklist chính.

## 1. Backlog và trạng thái

- [x] **B09/B10 — Review DTO/orders integration và sửa ghi snapshot (2026-10-26)** `order.dto.ts` giữ nguyên vì phù hợp bounds1..50 cấu hình sau gộp, qty1..99, topping0..10. Tái hiện nested create vượt deadline local, rollback trước lệnh con gây lỗi FK/503; chuyển OrderService sang ghi Order → bulk Item → bulk Topping → đọc snapshot trong cùng transaction, giữ stock/Cart/claim/Loyalty và runtime policy. `orders.spec.ts` kiểm tra đủ50 cấu hình/topping/giá snapshot, thêm fault topping rollback parent/stock/claim và retry cùng key một lần; fixture công khai budget2000/5000ms cho test chức năng, không dùng làm bằng chứng NFR01/local400ms. Acceptance: **80/80 PostgreSQL orders tests** trên cluster local riêng và **172/172 unit/HTTP tests qua5 suites** (pricing, order-history, operator-orders, loyalty-redemption, sandbox-gate) pass; focused lint, backend typecheck/build và diff checks pass. Unit run dùng MOCK/URL DB giả chỉ trong tiến trình, không đổi `.env` VNPAY; Jest exit0 nhưng cảnh báo một worker không thoát graceful, chưa xác định handle trong phạm vi này. Cluster test đã stop và xóa đúng thư mục do harness tạo; không ghi/migrate/seed Neon, không restart backend đang chạy (health200). Quyết định và giới hạn ở DECISIONS; VNPAY PAID E2E vẫn chưa kiểm chứng và callback ngrok ngoài máy vẫn cần owner khôi phục.

- [x] **B03/B19 — Một file cấu hình `.env` (2026-10-26)** Theo yêu cầu người dùng, bỏ các env mẫu và overlay VNPAY/frontend; hợp nhất cấu hình riêng tư vào `.env` gốc, kiểm tra giữ nguyên giá trị trước khi xóa overlay. Backend/Prisma/launcher dùng file gốc; Next chỉ nạp hai URL API từ file đó, giữ ưu tiên biến môi trường shell. README và hướng dẫn cấu hình đã đồng bộ; quyết định này thay thế phần env example trong các mục lịch sử bên dưới, không tự thay baseline PDF NFR08. Acceptance: parser MOCK/VNPAY hợp lệ, `.env` được Git ignore, chỉ còn một file env trong các thư mục source; test cấu hình frontend và launcher pass; build từ `.env` gốc pass, quét 51 browser assets không thấy các giá trị riêng tư đã đối chiếu; liên kết Markdown README/Docs hợp lệ. Không công bố secret hoặc sửa dữ liệu DB.

- [x] **B03/B19/A04–A06 và checkout/session — Sửa sáu lỗi đã rà soát (2026-10-26)** Recovery khởi động frontend còn thiếu và giữ monitor; admin catalog dùng transaction policy theo môi trường; checkout giải phóng payment context khi MOCK timeout hoặc Order đã kết thúc; session cookie UUID sai trả 401 trước SQL; payment retry về `/checkout`; hai catch-up workers phân trang bằng cursor DB để bản ghi lỗi không chặn các dòng phía sau, giữ độ chính xác timestamp và không bỏ qua dòng kế tiếp khi anchor hết điều kiện. Acceptance: backend 33 suites/899 tests, frontend 255 tests, launcher 20 tests đều pass; lint, typecheck hai workspace, build backend/frontend và syntax/diff checks pass. Kiểm tra Prisma cursor thực tế trên Neon chỉ đọc xác nhận loại anchor vẫn giữ dòng kế tiếp; không migrate/seed, không ghi giao dịch tài chính hoặc chạy VNPAY/browser E2E. Các giới hạn callback/shared DB đã ghi nhận ở mục chẩn đoán vẫn cần owner xử lý trước nghiệm thu runtime thực tế.

- [x] **B03/B19 — Chẩn đoán launcher chặn MOCK (2026-10-26)** Tái hiện `npm run dev` dừng trước khi mở frontend/backend vì shared DB còn gateway dependency; lỗi `Error` không có `code` khiến launcher chỉ in lỗi chung. Giữ guard, gắn `OUTSTANDING_GATEWAY_USE_VNPAY`, thêm hướng dẫn callback owner + `dev:vnpay`, kiểm tra MOCK dependency trước build và vẫn kiểm tra lại trước start để tránh race. 19 runtime tests pass, regression kiểm tra exact error code và không start service; chạy CLI thực xác nhận exit1 với mã/hướng dẫn cụ thể, không build khi đang bị chặn; syntax và diff checks pass. Auth chưa được kết luận sai mật khẩu; hai operator accounts có role tương ứng, bảng session tồn tại, callback owner endpoint đang404 ở lần kiểm tra trước. Không sửa tài khoản/mật khẩu/quyền/gateway state hoặc nới payment/startup guard.

- [x] **B03/B19 — Sửa lỗi chạy local Windows (2026-10-26)** Đồng bộ frontend dev/build và launcher snapshot build dùng Webpack khi native SWC bị Windows Application Control chặn; pin Nest Express adapter 11.2.7 cùng core/common/testing, cập nhật lockfile; khôi phục `.env.example` chỉ chứa placeholder. Sửa lệnh test frontend bị chèn nhầm và lint mock Cart; cập nhật exact operator-detail assertion theo deadline fields của checkout amendment đã duyệt. Acceptance: frontend/backend build pass, lint và hai workspace typecheck pass, Prisma validate pass; 250 frontend tests và 19 runtime tests pass. Backend lượt tổng: 29/30 suites pass, 2/885 tests fail do assertion cũ trong operator suite đã chạy trước lúc sửa; chạy lại riêng operator suite sau sửa: 50/50 pass; Cart + operator focused: 67/67 pass. HTTP smoke: home/login/cart/health/products 200, auth proxy/session không cookie 401, login empty-body 400, catalog CORS đúng localhost. Env example parse/default MOCK và local links README/DECISIONS/PLAN hợp lệ; `git diff --check` pass. Backend standalone hiện có được giữ, frontend chạy bằng `npm run dev:frontend`; chưa khởi động lại toàn bộ launcher do cổng3001 đang dùng và read-only dependency audit thấy unresolved gateway/reservation. Không thay schema/API, migrate/seed hoặc chạy financial/browser-write tests trên Neon; chưa nghiệm thu VNPAY PAID E2E hay browser matrix.

- [x] **Checkout/session amendment (2026-10-22)** [Contract và rollout](CHECKOUT_SESSION_UPDATE.md): deadline600s lưu DB, expiration/verified-receipt catch-up workers; không hủy UNKNOWN thiếu evidence; Cart lấy snapshot tại create Order và settlement không đụng Cart B; `/checkout` độc lập, active-order dialog; rotating HttpOnly session7 ngày + JWT3600s/sid revocation/CSRF cho3 roles. 12 PostgreSQL local integration tests, 98 frontend focused tests, 62 backend focused tests; frontend/backend lint/typecheck/build pass. Edge trên frontend production build + database local mới kiểm tra F5/logout3 roles, Cart B không mất và Checkout B không tạo Order mới, responsive390/1440px. Migration additive đã deploy Neon, fingerprint7 bảng nghiệp vụ trước/sau không đổi. Không reset/seed/restore Neon, không automated financial test hoặc VNPAY thật trên Neon, không commit/push. Activation trên runtime đang có phải giữ callback continuity; xem contract.

- [x] **B03/B06/B07 — Customer API configuration (2026-10-22)** Sửa thiếu `NEXT_PUBLIC_API_BASE_URL` khi Next standalone không đọc root `.env`: dev mặc định `http://127.0.0.1:3001`, launcher build/runtime và env example thống nhất; giữ explicit override và yêu cầu cấu hình production. 35 frontend focused tests, 19 runtime tests, 8 backend HTTP tests pass; frontend/backend typecheck và frontend lint pass. Edge trên runtime hiện có tải sản phẩm, login sai 401, đăng ký email trùng 409; `/health`, `/products` 200, auth validation 400, CORS preflight 204. Neon chỉ đọc để chọn email trùng và kiểm tra số tài khoản không đổi; không thử tạo tài khoản hoặc login thành công trên Neon, success paths dùng frontend fixture tests. Không sửa business/payment/schema hoặc dừng callback.

- [x] **P01 Normal admission / UNKNOWN isolation (2026-10-21)** Tách lý do operator drain/stop khỏi financial dependencies; giữ stop intent qua monitor, explicit recover tiếp tục phục vụ khi readiness hợp lệ dù chưa safe-to-stop. 19 runtime tests và 27 `sandbox-drain` integration tests trên database local cô lập pass, gồm expired AWAITING/UNKNOWN, khách độc lập, reservation bất biến, same-Order guards, late IPN và duplicate effects. Backend lint pass; không sửa dữ liệu Neon, không thay financial/API/schema contract hoặc chạy full regression. [Vận hành và giới hạn nạp launcher](NORMAL_SANDBOX_MODE.md).

- [x] **B03/B19/P01 — VNPAY Sandbox + Neon (2026-10-21)** Development gate nhận TLS pooled Neon, callback owner/member, bounded remote transaction deadline và pooled-safe dependency checks; giữ financial/state contracts. 352 unit/HTTP, 188 isolated-local financial và 16 runtime tests pass; Neon read-only smoke/profile/ingress và dữ liệu không đổi đã kiểm chứng. [Kết quả và thao tác TEST do owner thực hiện](VNPAY_NEON.md); actual PAID E2E không được suy từ synthetic tests.

- [x] **B03/B19 — Neon shared development (2026-10-21)** Restore đầy đủ local lên Neon, giữ local; 49 bảng/314 bản ghi, constraints/indexes/sequence và 13 migrations khớp; Prisma pooled/NestJS `/health` đã kiểm chứng. [Bằng chứng và giới hạn](NEON_DEVELOPMENT.md). Không thay cho nghiệm thu B17–B19 tổng thể.

- [x] **B01** Baseline FR/NFR/BR, design closure; [requirements](REQUIREMENTS.md), [decisions](DECISIONS.md).
- [ ] **B02** Nhóm xác nhận thành viên/PO/SM/phân công, backlog/sprint và evidence Scrum thực tế.
- [x] **B03–B07** npm workspaces, DB/catalog/menu/options/auth; source và contract tương ứng trong Docs.
- [x] Cart validation hardening: service validates qty 1..99 (including merged qty), topping count <=10, and each monetary component before addition. Unit regression + pricing: 61 tests pass; backend TypeScript and focused ESLint pass. Database integration not run; no Neon access.
- [x] Cart UI: responsive item images/quantity controls and separate summary; checkout blocked during load/edit/write/recovery, on empty cart or unavailable items. Existing two-request option editing and server pricing preserved. Frontend 248 tests, typecheck and focused ESLint pass. Production build blocked locally by missing Linux native CSS dependencies; visual/browser interaction verification pending.
- [x] Cart deletion confirmation: show product/options/quantity, explicit keep/delete, focus keep by default, Escape cancels when idle, lock actions while pending and require confirmation before DELETE. Frontend tests/typecheck/focused lint checked; browser interaction validation pending.
- [x] **B08** Cart authenticated PostgreSQL, merge/options/qty/ownership và khóa active unpaid.
- [x] **B09–B10** Server pricing, Order snapshot/PENDING, stock OCC/idempotency, unpaid cancel.
- [x] **B11–B12** MOCK payment, atomic PAID/award, checkout/replay/retry UI.
- [x] **B13–B16** Promotion checkout, Loyalty balance, history, workflow/internal paid-cancel.
- [ ] **B17** Có PostgreSQL integration suites; còn cần kết luận acceptance tổng hợp theo môi trường bàn giao.
- [ ] **B18** Full browser matrix (bao gồm Firefox), đo mọi mẫu API <500 ms theo protocol; không thay bằng số PASS unit lịch sử.
- [ ] **B19** README/env/setup đã cập nhật; clean-clone trên máy thành viên và Docker Compose ba service chưa nghiệm thu. Repository hiện chưa có Compose.
- [ ] **B20** Owner review, demo cuối, handover Git và retrospective/feedback thực tế.
- [x] **A01–A06/UI01** RBAC/operator, product/options/inventory và role UX đã có source/tests; A08/A09 chưa duyệt.
- [x] **A07** Đã hủy/forward compensation theo owner; giữ migration chain, không khôi phục Campaign.
- [x] **L00/L01** Approved redemption/journal/debt và read-only reconciliation đã có source/tests.
- [x] **P00/P01** VNPAY Sandbox config/signing/initiation/IPN/Return/zero/status/guards và Normal launcher đã có source/tests.
- [ ] **P01 SUCCESS E2E** Giao dịch hủy verified đã được owner ghi nhận; chưa có bằng chứng PAID E2E đầy đủ trong đợt tài liệu này.
- [x] **Documentation release preparation** README tiếng Việt, Docs cleanup có phân loại, cấu trúc thực tế, kiểm tra links/env/scripts/index; kết quả chi tiết ở [README dự án](../README.md).
- [ ] **GitHub integration** Hai root histories khác nhau; owner chọn phương án trước commit/push, không tự merge/force.

## 2. Acceptance phải giữ

| Nhóm | Điều kiện nghiệm thu |
| --- | --- |
| FR01–10 | Menu → options → authenticated Cart → Checkout → payment → confirmation/history, loading/empty/error và ownership |
| FR11–12 | Đủ bảy state PDF, reject cạnh sai, retry qua PENDING, cancel đúng quyền; không refund giả |
| FR13 | Same key replay, payload conflict, double-click/cross-key same Order không duplicate financial effects |
| FR14 | Transaction + OCC, stock cuối cùng với hai khách, nhiều dòng cùng Product, fault rollback |
| FR15–16 | Promotion/points theo server; reserve/settle/release/retry/refund/debt; award/reverse đúng một lần |
| Gateway | Signature/merchant/reference/amount/result/binding; verified IPN mới settle; Return read-only; receipt replay/UNKNOWN/REVIEW giữ an toàn |
| Normal Mode | MOCK không cần credentials; không một-Attempt/30 phút; admission/continuity/drain/stop đúng guards |
| NFR01/03 | Protocol latency/browser ở DECISIONS, ghi version/môi trường và từng mẫu, chưa có evidence thì chưa Done |
| NFR07–08 | Review Git, secrets, setup clone sạch, Compose theo PDF và demo/Scrum thực tế |

## 3. Definition of Done

Phạm vi được giao rõ và truy về FR/extension; code/config/docs đồng bộ khi đổi contract; tests/lint/typecheck/build phù hợp có kết quả thực; validation/ownership/UI states đầy đủ; không secrets. Review nhóm và nghiệm thu không được suy từ thiết kế hoặc checkbox triển khai.

Documentation-only checks không chạy migrations/seed/gateway. Nếu dọn evidence còn là script input, giữ REVIEW và xin quyết định retire helper trong task riêng. Shared Staging/production, CI/CD hoặc refactor ngoài phạm vi cần owner giao riêng.

[Traceability](TRACEABILITY_MATRIX.md) · [Design review](DESIGN_REVIEW.md) · [Setup](../README.md).
