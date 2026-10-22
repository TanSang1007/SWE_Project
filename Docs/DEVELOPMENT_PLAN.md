# BrewLite — Kế hoạch phát triển và bàn giao

Trạng thái căn cứ source và contract hiện có; checkbox implementation không thay cho toàn bộ nghiệm thu PDF/DoD. Không giữ nhật ký từng lần Gate/FIX trong checklist chính.

## 1. Backlog và trạng thái

- [x] **Checkout/session amendment (2026-10-22)** [Contract và rollout](CHECKOUT_SESSION_UPDATE.md): deadline600s lưu DB, expiration/verified-receipt catch-up workers; không hủy UNKNOWN thiếu evidence; Cart lấy snapshot tại create Order và settlement không đụng Cart B; `/checkout` độc lập, active-order dialog; rotating HttpOnly session7 ngày + JWT3600s/sid revocation/CSRF cho3 roles. 12 PostgreSQL local integration tests, 98 frontend focused tests, 62 backend focused tests; frontend/backend lint/typecheck/build pass. Edge trên frontend production build + database local mới kiểm tra F5/logout3 roles, Cart B không mất và Checkout B không tạo Order mới, responsive390/1440px. Migration additive đã deploy Neon, fingerprint7 bảng nghiệp vụ trước/sau không đổi. Không reset/seed/restore Neon, không automated financial test hoặc VNPAY thật trên Neon, không commit/push. Activation trên runtime đang có phải giữ callback continuity; xem contract.

- [x] **B03/B06/B07 — Customer API configuration (2026-10-22)** Sửa thiếu `NEXT_PUBLIC_API_BASE_URL` khi Next standalone không đọc root `.env`: dev mặc định `http://127.0.0.1:3001`, launcher build/runtime và env example thống nhất; giữ explicit override và yêu cầu cấu hình production. 35 frontend focused tests, 19 runtime tests, 8 backend HTTP tests pass; frontend/backend typecheck và frontend lint pass. Edge trên runtime hiện có tải sản phẩm, login sai 401, đăng ký email trùng 409; `/health`, `/products` 200, auth validation 400, CORS preflight 204. Neon chỉ đọc để chọn email trùng và kiểm tra số tài khoản không đổi; không thử tạo tài khoản hoặc login thành công trên Neon, success paths dùng frontend fixture tests. Không sửa business/payment/schema hoặc dừng callback.

- [x] **P01 Normal admission / UNKNOWN isolation (2026-10-21)** Tách lý do operator drain/stop khỏi financial dependencies; giữ stop intent qua monitor, explicit recover tiếp tục phục vụ khi readiness hợp lệ dù chưa safe-to-stop. 19 runtime tests và 27 `sandbox-drain` integration tests trên database local cô lập pass, gồm expired AWAITING/UNKNOWN, khách độc lập, reservation bất biến, same-Order guards, late IPN và duplicate effects. Backend lint pass; không sửa dữ liệu Neon, không thay financial/API/schema contract hoặc chạy full regression. [Vận hành và giới hạn nạp launcher](NORMAL_SANDBOX_MODE.md).

- [x] **B03/B19/P01 — VNPAY Sandbox + Neon (2026-10-21)** Development gate nhận TLS pooled Neon, callback owner/member, bounded remote transaction deadline và pooled-safe dependency checks; giữ financial/state contracts. 352 unit/HTTP, 188 isolated-local financial và 16 runtime tests pass; Neon read-only smoke/profile/ingress và dữ liệu không đổi đã kiểm chứng. [Kết quả và thao tác TEST do owner thực hiện](VNPAY_NEON.md); actual PAID E2E không được suy từ synthetic tests.

- [x] **B03/B19 — Neon shared development (2026-10-21)** Restore đầy đủ local lên Neon, giữ local; 49 bảng/314 bản ghi, constraints/indexes/sequence và 13 migrations khớp; Prisma pooled/NestJS `/health` đã kiểm chứng. [Bằng chứng và giới hạn](NEON_DEVELOPMENT.md). Không thay cho nghiệm thu B17–B19 tổng thể.

- [x] **B01** Baseline FR/NFR/BR, design closure; [requirements](REQUIREMENTS.md), [decisions](DECISIONS.md).
- [ ] **B02** Nhóm xác nhận thành viên/PO/SM/phân công, backlog/sprint và evidence Scrum thực tế.
- [x] **B03–B07** npm workspaces, DB/catalog/menu/options/auth; source và contract tương ứng trong Docs.
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
