# Neon development dùng chung

Ngày 2026-10-21, thực hiện tại clone `D:\SWE_Project`, branch `sang`; không sửa clone `D:\CNPM` trên `main`. Phạm vi foundation/setup B03/B19 theo [kế hoạch](DEVELOPMENT_PLAN.md). Không thay requirement PDF, schema, business logic hoặc financial contract.

Database chung là `brewlite_dev`, Neon PostgreSQL 18.6. Root `.env` private đã được cấu hình từ file private owner cung cấp. Thành viên điền credentials được cấp riêng theo [.env.example](../.env.example): pooled `DATABASE_URL` cho backend PrismaPg, direct `DIRECT_URL` cho Prisma CLI/quản trị. Hai URL cùng database, có TLS. Không đưa URL thật lên Git hoặc logs.

## Kết quả chuyển dữ liệu

- Đích được kiểm tra trống trước restore: không bảng/view/sequence nghiệp vụ, routines hoặc custom types.
- Local PostgreSQL 18.6 không có client khác; unresolved Attempts, unprocessed verified receipts, reservations và incomplete claims đều bằng 0 trước backup. Giữ SHARE locks chống ghi trong thời gian dump/restore, rồi rollback transaction giữ khóa; không cập nhật dữ liệu local.
- Backup mới bằng PostgreSQL 18 `pg_dump --format=custom`, nguồn local được kiểm tra host loopback, port 5432, database `brewlite_dev`. Backup nằm ngoài repository tại `D:\BrewLite-backups\neon-transfer-2026-10-21T15-00-38-492Z\brewlite_dev.dump`, 206357 bytes, giới hạn ACL cho owner. Đã kiểm tra header, TOC và giải mã toàn archive offline.
- SHA-256 backup: `10df584815052b0eef978fbc59ea36912c570b0ec1c2e1ec7359470c32fd9ac1`.
- `pg_restore` dùng direct endpoint, `--single-transaction --exit-on-error --no-owner --no-acl`; giữ namespace `public` trống có sẵn của Neon, restore đầy đủ nội dung. Ownership/ACL dùng role Neon; không sao chép role local. Không clean/drop database, không seed hoặc chạy migrations lại.
- 49 bảng / 314 bản ghi được chuyển, bao gồm 19 bảng trong `public` và 30 bảng thuộc hai schema test cũ. `_prisma_migrations` có đủ 13 migration đã hoàn tất. Checksum khớp source với quy ước LF/CRLF của Prisma trên Windows.
- Đối chiếu số dòng và hash toàn bộ nội dung từng bảng ở UTC đều khớp local/Neon; constraints (74 foreign keys, trong đó 30 ở `public`), indexes, sequence và migration history đều khớp. Timestamp được chuẩn hóa UTC khi đối chiếu để loại sai khác timezone hiển thị giữa hai server.

| Dữ liệu trong public | Số bản ghi |
| --- | ---: |
| products | 5 |
| users | 4 |
| orders | 25 |
| payments | 17 |
| payment_attempts | 4 |
| payment_verifications | 4 |
| _prisma_migrations | 13 |

## Kiểm chứng và sử dụng

Prisma 7.10: `db:validate`, generate, backend build, backend lint và `prisma migrate status` đều pass; 15 runtime tests pass. Lint được chạy sau generate hoàn tất. NestJS AppModule khởi động với PrismaService thực qua pooled endpoint, đọc đúng database và các số lượng trên; HTTP GET `/health` trả 200 `{"status":"ok"}`. Server kiểm chứng dùng port loopback tạm và đã đóng. Không tạo Order/PaymentAttempt hoặc gọi VNPAY. Kiểm chứng này không thay cho full business integration/latency acceptance trên Neon.

Thành viên mới điền `.env`, chạy `npm ci`, `npm run db:validate`, `npm run db:generate`, `npm run db:status`, sau đó `npm run dev`. Không seed/reset/migrate lại để setup database chung. Chỉ người phụ trách schema áp dụng migration mới đã được nhóm duyệt; integration tests phải dùng database test riêng.

Neon hiện hỗ trợ cả MOCK và VNPAY Sandbox theo giao việc tiếp theo của owner. [VNPAY + Neon](VNPAY_NEON.md) ghi guard mới, callback owner/member và kiểm chứng riêng. Backend/frontend vẫn chạy trên máy thành viên, không có triển khai staging/production.

PostgreSQL local và backup được giữ nguyên để dự phòng; sau khi nhóm ghi dữ liệu mới lên Neon, local không tự đồng bộ. Không restore đè Neon đã có dữ liệu. Credentials và dump không được commit/push.
