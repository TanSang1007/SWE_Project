# BrewLite — Hướng dẫn làm việc trong repository

## Đọc tài liệu trước khi coding

- Đọc README.md và các tài liệu liên quan trong `Docs/`: REQUIREMENTS, DECISIONS, ARCHITECTURE, DATABASE_DESIGN, API_DESIGN, PROJECT_STRUCTURE, DEVELOPMENT_PLAN và TRACEABILITY_MATRIX.
- PDF `Docs/BrewLite-CongNghePhanMem.pdf` là baseline yêu cầu. Không sửa PDF và không tự thêm, bỏ hoặc thay requirement. Phân biệt yêu cầu PDF, quyết định kỹ thuật và đề xuất nghiệp vụ chưa được người dùng chọn.
- Kiểm tra trạng thái closure trong DECISIONS và DESIGN_REVIEW. Không tự lấy recommended option làm câu trả lời của người dùng; task phụ thuộc quyết định còn mở phải chờ câu trả lời, các phần độc lập có thể tiếp tục trong phạm vi được giao.

## Phạm vi và thiết kế

- Chỉ làm phạm vi task hiện tại. Không sửa các phần không liên quan hoặc thực hiện refactor diện rộng khi không cần thiết.
- Ưu tiên code đơn giản, dễ đọc, dễ maintain và dễ demo. Không over-engineering; không tự thêm microservices, queue, cache, distributed transaction hoặc hạ tầng production.
- Không thay database schema mà không cập nhật `Docs/DATABASE_DESIGN.md`, ràng buộc/quan hệ và tài liệu liên quan trong cùng task.
- Không thay API path, DTO, quyền, status hoặc error contract mà không cập nhật `Docs/API_DESIGN.md` và traceability liên quan.
- Mỗi task phải nhỏ, có kết quả kiểm chứng được, acceptance criteria rõ và truy về requirement/backlog.

## Kiểm chứng và tiến độ

- Khi project đã hỗ trợ test/lint/build, chạy các kiểm tra phù hợp với phần thay đổi và các check bắt buộc. Báo rõ check đã chạy, kết quả và giới hạn; không tuyên bố pass khi chưa chạy.
- Với thay đổi chỉ tài liệu, kiểm tra liên kết, tính nhất quán và phạm vi file; không cài package chỉ để kiểm tra Markdown.
- Không đánh dấu implementation hoàn thành chỉ vì đã có thiết kế. Cập nhật checklist `Docs/DEVELOPMENT_PLAN.md` khi task hoàn thành và có bằng chứng kiểm chứng.
- Ghi quyết định kỹ thuật làm thay đổi baseline thiết kế vào `Docs/DECISIONS.md`; cập nhật matrix khi mapping thay đổi.
- Không đưa secret, token hay mật khẩu thật vào tài liệu/commit. `.env.example` chỉ dùng giá trị mẫu.

## Trạng thái tại lúc tạo file

Đang DESIGN CLOSURE, chỉ làm tài liệu. Chưa viết application code, tạo frontend/backend, cài package, tạo database/migration hoặc implement API. Chỉ chuyển sang coding khi người dùng giao giai đoạn development.
