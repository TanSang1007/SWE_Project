# BrewLite — Kế hoạch phát triển và bàn giao

Trạng thái căn cứ source và contract hiện có; checkbox implementation không thay cho toàn bộ nghiệm thu PDF/DoD. Không giữ nhật ký từng lần Gate/FIX trong checklist chính.

## 1. Backlog và trạng thái

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
