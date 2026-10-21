# BrewLite — Design review và giới hạn nghiệm thu

## 1. Closure thiết kế

Q01–Q19 và DR01–DR15 đã có quyết định hoặc scope trong [DECISIONS](DECISIONS.md); không biến recommended option thành owner approval. Baseline PDF/FR/NFR/BR và graph được giữ nguyên. Extension A01–A06/UI01, L00/L01 và P00/P01 có contract riêng; A07 đã hủy.

| Findings | Kết luận thiết kế |
| --- | --- |
| DR01/14/15 | Customer chỉ unpaid cancel; internal paid-cancel nguyên tử stock/award/redemption/debt, không refund gateway |
| DR02 | Direct stock tại PENDING, không TTL/job tự release; bỏ dở phải xử lý theo trạng thái thật |
| DR03 | Giá DB, fixed promotion, Loyalty floor tại PAID; zero explicit và bounds |
| DR04 | Phạm vi operator gốc được mở rộng có phê duyệt D35/D40, không suy rộng thêm role/actions |
| DR05–08 | Idempotency/hash/replay transaction, PK/FK/UQ/CHECK và lifecycle invariants có source/tests; không dùng frontend guard làm authority |
| DR09–10 | Module ownership, CORS/images, user-bound context; Cart persistence đã thay bởi B08/D29 |
| DR11 | Latency/browser protocol giữ nguyên, implementation tests không chứng minh full NFR |
| DR12 | Chỉ đánh Done đúng phạm vi thực hiện; backlog hiện tại ở DEVELOPMENT_PLAN |
| DR13 | Đúng PDF baseline/hash, AGENTS.md được giữ |

## 2. Financial/security review boundary

P00 frozen contract + attribution amendment giữ verified IPN settlement/T1/T2, Return read-only, exact replay và UNKNOWN/REVIEW protection. Normal Mode bỏ quota của harness nhưng không bỏ guards theo Order/Attempt/service health. [Database](DATABASE_DESIGN.md) ghi uniqueness/OCC/journal, [API](API_DESIGN.md) ghi permission/DTO/error.

Cancel Home UX chỉ dựa `failureReason=CUSTOMER_CANCELLED` từ persisted verified/applied result; hủy gateway không tự suy Order CANCELLED. ngrok Free interstitial xảy ra trước app và không được bypass bằng header/User-Agent.

## 3. Chưa được coi là nghiệm thu hoàn tất

- PAID VNPAY Sandbox E2E đầy đủ: verified cancellation không thay cho verified success/inventory/loyalty reconciliation.
- Browser matrix đầy đủ, NFR01 từng mẫu <500 ms trên máy bàn giao và clean-clone bởi thành viên khác.
- Docker Compose ba service theo yêu cầu PDF chưa có source; không tự thêm infrastructure trong task tài liệu.
- Phân công nhóm/evidence Scrum/demo cuối cần nhóm xác nhận, không tạo tên/biên bản giả.
- GitHub main có root history riêng; owner chọn phương án tích hợp và review uncommitted source trước commit/push.

## 4. Review đợt chuẩn bị tài liệu

Chỉ README/Docs và safe environment example được chỉnh. Không migrations, seed, runtime restart, gateway request, DB/financial logic change hoặc commit/push. [README dự án](../README.md) ghi phân loại cleanup và phần REVIEW chưa xóa. [Plan](DEVELOPMENT_PLAN.md) giữ checklist thực tế.
