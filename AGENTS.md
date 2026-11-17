# BrewLite — Hướng dẫn làm việc trong repository

## Đọc yêu cầu và code trước khi coding

- Đọc README.md, comment cạnh module liên quan, controller/DTO, Prisma schema và migration trước khi sửa. Người dùng đã yêu cầu gộp tài liệu vào code/README và xóa các file Markdown trong thư mục tài liệu riêng.
- PDF đồ án do người dùng cung cấp là baseline yêu cầu. Không sửa hoặc xóa PDF và không tự thêm, bỏ hoặc thay requirement. Phân biệt yêu cầu PDF, quyết định kỹ thuật và đề xuất nghiệp vụ chưa được người dùng chọn.
- Quyết định kho/O01 đã chốt và mapping sang code nằm trong README. Không tự lấy recommended option làm câu trả lời của người dùng; task phụ thuộc quyết định còn mở phải chờ câu trả lời, các phần độc lập có thể tiếp tục trong phạm vi được giao.

## Phạm vi và thiết kế

- Chỉ làm phạm vi task hiện tại. Không sửa các phần không liên quan hoặc thực hiện refactor diện rộng khi không cần thiết.
- Ưu tiên code đơn giản, dễ đọc, dễ maintain và dễ demo. Không over-engineering; không tự thêm microservices, queue, cache, distributed transaction hoặc hạ tầng production.
- Khi thay database schema, cập nhật comment quan hệ/ràng buộc trong Prisma, migration và hướng dẫn liên quan trong README trong cùng task. Không sửa migration đã áp dụng.
- Khi thay API path, DTO, quyền, status hoặc error contract, cập nhật comment tại controller/DTO/service, kiểm tra liên quan và mapping trong README.
- Mỗi task phải nhỏ, có kết quả kiểm chứng được, acceptance criteria rõ và truy về requirement/backlog.

## Kiểm chứng và tiến độ

- Khi project đã hỗ trợ test/lint/build, chạy các kiểm tra phù hợp với phần thay đổi và các check bắt buộc. Báo rõ check đã chạy, kết quả và giới hạn; không tuyên bố pass khi chưa chạy.
- Với thay đổi chỉ tài liệu, kiểm tra liên kết, tính nhất quán và phạm vi file; không cài package chỉ để kiểm tra Markdown.
- Không đánh dấu implementation hoàn thành chỉ vì đã có thiết kế. Ghi kết quả và giới hạn kiểm chứng trong báo cáo task; cập nhật trạng thái khôi phục trong README khi có bằng chứng.
- Ghi quyết định kỹ thuật làm thay đổi baseline thiết kế cạnh code liên quan và trong README; cập nhật mapping requirement/code/test khi thay đổi.
- Không đưa secret, token hay mật khẩu thật vào tài liệu/commit. `.env.example` chỉ dùng giá trị mẫu.

## Trạng thái hiện tại

Người dùng đã giao development và khôi phục kho/theo dõi đơn. Repository có frontend/backend và các kiểm tra tương ứng. Chỉ sửa phạm vi task hiện tại; không tạo lại bộ tài liệu riêng nếu chưa được yêu cầu.
