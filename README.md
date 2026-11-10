# BrewLite — Ứng dụng đặt cà phê

Đồ án môn **Công nghệ phần mềm**: xem menu, chọn size/topping, quản lý giỏ hàng, đặt món, thanh toán qua VNPAY Sandbox và theo dõi đơn. Có chức năng khuyến mãi, điểm thưởng và quản lý dành cho Admin/Staff.

## 1. Thành viên

| MSSV | Họ và tên |
| --- | --- |
| 3124410156 | Đỗ Trọng Khoa |
| 3123410301 | Đoàn Tấn Sang |
| 3124410026 | Nguyễn Thị Kim Chi |
| 3124410023 | Lê Nguyễn Băng Châu |
| 3124410084 | Đoàn Trung Hậu |
| 3124410214 | Trần Tuấn Minh |

**Công nghệ:** Next.js/React/TypeScript, NestJS, PostgreSQL/Prisma, JWT/bcrypt, VNPAY Sandbox và Docker Compose.

## 2. Cách chạy của nhóm

Hướng dẫn chính dành cho **Windows và Docker dùng chung database Neon**. Mỗi thành viên chạy frontend/backend trên máy mình; một máy **callback owner** giữ đường nhận kết quả VNPAY cho cả nhóm.

| Thành phần | Địa chỉ / nơi lưu |
| --- | --- |
| Website | http://localhost:3000 |
| Backend API | http://localhost:3002 — chuyển vào cổng 3001 trong container |
| Callback ingress | Cổng 3102 trên máy; thành viên không cần mở ngrok riêng |
| Database nhóm | Neon dùng chung qua `compose.neon.yaml` |
| PostgreSQL container | Volume riêng, chỉ được ứng dụng sử dụng khi chạy chế độ local ở mục 7 |

Docker Desktop đã tích hợp Docker Engine và Compose; **không cần cài Node.js, npm hoặc PostgreSQL trên Windows** để chạy theo hướng dẫn này.

## 3. Cài Docker từ đầu

### Bước 1 — Kiểm tra máy

Dùng Windows 64-bit còn được Docker Desktop hỗ trợ, RAM tối thiểu 8 GB và Internet. Nên dành khoảng 15–20 GB ổ đĩa trống cho image, thư viện và dữ liệu.

Mở **Task Manager → Performance → CPU**, kiểm tra **Virtualization: Enabled**. Nếu Disabled, bật Intel VT-x/AMD-V trong BIOS/UEFI theo hướng dẫn của hãng máy trước khi tiếp tục.

### Bước 2 — Cài WSL 2

Mở Start, tìm **PowerShell → Run as administrator**, chạy:

```powershell
wsl --install
```

Khởi động lại Windows nếu được yêu cầu. Nếu Ubuntu mở lên yêu cầu username/password, tạo tài khoản Linux theo hướng dẫn; tài khoản này không phải tài khoản BrewLite.

Mở lại PowerShell, chạy:

```powershell
wsl --update
wsl --set-default-version 2
wsl --version
```

Nếu WSL đã cài thì không cần cài lại; cập nhật WSL và dùng phiên bản 2. Tham khảo [Microsoft: cài WSL](https://learn.microsoft.com/en-us/windows/wsl/install).

### Bước 3 — Cài Docker Desktop

1. Tải từ [Docker Desktop cho Windows](https://docs.docker.com/desktop/setup/install/windows-install/). Máy Intel/AMD chọn bản **x86_64**; máy ARM chọn bản phù hợp.
2. Chạy bộ cài, chọn **WSL 2** nếu được hỏi; hoàn tất và khởi động lại khi được yêu cầu.
3. Mở **Docker Desktop**, hoàn tất màn hình thiết lập và chờ **Engine running**.
4. Dùng **Linux containers**. Nếu menu có “Switch to Linux containers…”, chọn mục đó.

Mở PowerShell mới, kiểm tra:

```powershell
docker version
docker compose version
docker info
docker run --rm hello-world
```

`docker info` phải có phần **Server**; lệnh cuối phải chạy thành công. Nếu không kết nối được `dockerDesktopLinuxEngine`, mở hoặc restart Docker Desktop trước khi tiếp tục.

### Bước 4 — Cài Git và lấy mã nguồn

Cài [Git for Windows](https://git-scm.com/download/win), mở PowerShell mới rồi chạy:

```powershell
git --version
git clone https://github.com/TanSang1007/SWE_Project.git
cd SWE_Project
```

Nếu bộ Docker chưa nằm trên nhánh mặc định, chuyển sang nhánh nhóm đã thông báo, ví dụ `git switch bangchau`. Thư mục phải có `Dockerfile`, `compose.yaml`, `compose.neon.yaml` và `docker/config.example`.

**Từ đây, chạy mọi lệnh tại thư mục `SWE_Project`.** Có thể dùng terminal PowerShell của VS Code.

## 4. Cấu hình và khởi động lần đầu

### Bước 5 — Tạo file cấu hình

Chỉ tạo file nếu chưa tồn tại:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
if (!(Test-Path docker/local.env)) { Copy-Item docker/config.example docker/local.env }
```

Trong **`.env` ở thư mục gốc**, điền hai URL Neon do nhóm cấp riêng:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST-POOLER/brewlite_dev?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@HOST-DIRECT/brewlite_dev?sslmode=require"
```

Cả hai phải trỏ tới cùng database của nhóm; backend dùng URL pooled có TLS. Không dùng nguyên thông tin mẫu.

Trong **`docker/local.env`**, điền:

```dotenv
DOCKER_DB_PASSWORD=REPLACE_WITH_RANDOM_LETTERS_AND_DIGITS
DOCKER_JWT_SECRET=REPLACE_WITH_RANDOM_SECRET
DOCKER_VNPAY_TMN_CODE=YOUR_MERCHANT_CODE
DOCKER_VNPAY_HASH_SECRET=YOUR_MERCHANT_HASH_SECRET
DOCKER_CALLBACK_ORIGIN=https://YOUR_REGISTERED_OWNER_DOMAIN
DOCKER_ACCEPT_PAYMENTS=false
```

| Biến | Nội dung cần điền |
| --- | --- |
| `DOCKER_DB_PASSWORD` | Tự đặt mật khẩu chỉ gồm chữ/số cho DB Docker; không phải mật khẩu Neon. |
| `DOCKER_JWT_SECRET` | Secret ngẫu nhiên tối thiểu 32 byte; tạo bằng lệnh bên dưới. |
| `DOCKER_VNPAY_TMN_CODE`, `DOCKER_VNPAY_HASH_SECRET` | Đúng thông tin Sandbox của nhóm, nhận qua kênh riêng. |
| `DOCKER_CALLBACK_ORIGIN` | HTTPS domain callback owner đã đăng ký cho merchant; không có `/` cuối hoặc đường dẫn IPN. |
| `DOCKER_ACCEPT_PAYMENTS` | Giữ `false` khi chuẩn bị hoặc owner chưa online. |

Tạo secret bằng PowerShell, sao chép chuỗi xuất ra vào `DOCKER_JWT_SECRET`:

```powershell
$secretBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$generator.GetBytes($secretBytes)
$generator.Dispose()
([BitConverter]::ToString($secretBytes)).Replace('-', '').ToLowerInvariant()
```

Các biến Docker được truyền qua Compose; không cần chỉnh provider của launcher npm để chạy container. **Không commit `.env`, `docker/local.env`, token ngrok hoặc khóa thật.**

### Bước 6 — Kiểm tra, build và chạy

```powershell
docker compose --env-file .env --env-file docker/local.env -f compose.yaml -f compose.neon.yaml config --quiet
docker compose --env-file .env --env-file docker/local.env -f compose.yaml -f compose.neon.yaml build
docker compose --env-file .env --env-file docker/local.env -f compose.yaml -f compose.neon.yaml up -d
docker compose --env-file .env --env-file docker/local.env -f compose.yaml -f compose.neon.yaml ps -a
```

- `config --quiet` không báo lỗi: cú pháp cấu hình hợp lệ, chưa chứng minh thông tin đăng nhập đúng.
- Build đầu có thể mất nhiều phút để tải image/thư viện; các lần sau tận dụng cache.
- Chờ backend và frontend **healthy**; `health: starting` ngay sau khởi động là bình thường.
- Mở **http://localhost:3000**, đăng nhập bằng tài khoản Neon hoặc đăng ký Customer mới.

**Không chạy migration, reset, seed hay restore lên Neon chung.** Chỉnh menu/tồn kho/đơn trên profile này ảnh hưởng cả nhóm. Luôn giữ cả hai `--env-file` và hai `-f` khi dùng Neon; bỏ override có thể chuyển backend về DB local.

## 5. Test thanh toán khi owner online

Trước khi owner online, vẫn test được menu, đăng ký/đăng nhập, giỏ hàng và tạo đơn; không coi thanh toán đã nghiệm thu.

1. Owner giữ backend cùng Neon/merchant và ngrok callback đã đăng ký hoạt động. Thành viên không cài hay mở ngrok riêng.
2. Kiểm tra bằng domain đúng trong `DOCKER_CALLBACK_ORIGIN`:

```powershell
curl.exe -i "https://YOUR_REGISTERED_OWNER_DOMAIN/payments/vnpay/ipn"
curl.exe -i "https://YOUR_REGISTERED_OWNER_DOMAIN/payments/vnpay/return"
```

IPN không chữ ký phải trả HTTP 200 và JSON `RspCode: "99"`; Return không dữ liệu phải trả HTTP 303 về trang kết quả localhost. Đây là kiểm tra đường truyền, chưa xác nhận giao dịch.

3. Khi callback/profile sẵn sàng, đổi `DOCKER_ACCEPT_PAYMENTS=true` trong `docker/local.env`, rồi áp dụng:

```powershell
docker compose --env-file .env --env-file docker/local.env -f compose.yaml -f compose.neon.yaml up -d --no-build backend frontend
```

4. Test **chọn món → giỏ → checkout → VNPAY bằng thẻ TEST → xác nhận/lịch sử**. Chỉ IPN được backend xác minh hợp lệ mới chuyển đơn `PAID`; quay về trang thành công chưa đủ. Kiểm tra lỗi/hủy giữ giỏ và không cộng điểm lặp.

Giữ owner online suốt buổi demo. Không tự đổi merchant/domain/khóa hoặc ép trạng thái bằng SQL khi giao dịch chưa rõ kết quả. Chỉ sửa URL trong env không đăng ký lại IPN phía VNPAY.

## 6. Sử dụng hằng ngày

Mở Docker Desktop trước. **Bật lại** mà không build:

```powershell
docker compose --env-file .env --env-file docker/local.env -f compose.yaml -f compose.neon.yaml up -d --no-build
```

**Xem lỗi:**

```powershell
docker compose --env-file .env --env-file docker/local.env -f compose.yaml -f compose.neon.yaml logs --tail 80 backend frontend
```

Sau khi cập nhật code bằng `git pull`, build lại nếu source/Dockerfile thay đổi. Sửa env thì chạy `up -d` để recreate; `restart` không cập nhật environment. Không dùng `npm run dev:status/recover/stop` để quản lý container.

**Dừng:** đóng nhận thanh toán mới và kiểm tra giao dịch còn chờ, bảo đảm callback owner vẫn hoạt động trước khi chạy:

```powershell
docker compose --env-file .env --env-file docker/local.env -f compose.yaml -f compose.neon.yaml down
```

Compose không có cơ chế `safeToStop` của launcher npm. Không dừng máy đang giữ callback khi còn giao dịch chưa giải quyết. `down` giữ volume; **`down -v` xóa volume DB local**. Dữ liệu Neon nằm ngoài volume.

## 7. Tùy chọn: PostgreSQL Docker riêng

Dùng để chạy đủ frontend/backend/DB local theo đề. Không dùng override Neon; điền `docker/local.env`, giữ thanh toán `false`:

```powershell
docker compose --env-file docker/local.env build
docker compose --env-file docker/local.env up -d db
docker compose --env-file docker/local.env ps
```

Chờ `db` healthy, rồi lần lượt chạy; chỉ tiếp tục khi lệnh trước thành công:

```powershell
docker compose --env-file docker/local.env run --rm --no-deps backend npm run db:migrate:deploy --workspace backend
docker compose --env-file docker/local.env run --rm --no-deps backend npm run db:seed --workspace backend
docker compose --env-file docker/local.env up -d
```

DB local lưu tài khoản/giỏ/đơn/tồn trong volume, seed chỉ có **2 món mẫu** và không có tài khoản Neon. Hình món nằm trong image frontend. Hai database không tự đồng bộ; callback owner nối Neon không xác nhận được đơn chỉ tồn tại ở DB local. Không chuyển profile trong khi đang thanh toán.

## 8. Xử lý lỗi nhanh

| Lỗi | Cách xử lý |
| --- | --- |
| Không tìm thấy `docker` | Cài Docker Desktop, mở terminal mới. |
| Không kết nối `dockerDesktopLinuxEngine` | Mở/restart Docker Desktop; kiểm tra Linux containers và `docker info`. |
| WSL/virtualization lỗi | Cập nhật WSL, bật virtualization trong BIOS/UEFI, khởi động lại Windows. |
| Cổng 3000 bị chiếm | Dừng đúng frontend khác nếu không dùng; không cần đóng toàn bộ Docker Desktop. |
| Cổng 3001 bị chiếm | Docker dùng host **3002 → container 3001**; kiểm tra mapping Compose, không đổi cổng nội bộ. |
| API sai địa chỉ | Frontend build arg phải là `NEXT_PUBLIC_API_BASE_URL=http://localhost:3002`; đổi giá trị này cần build lại frontend. |
| Chỉ thấy 2 món / mất tài khoản cũ | Kiểm tra đang dùng DB local hay Neon; đăng nhập đúng database. |
| Backend không healthy | Xem logs; Neon không tự reset/migrate để sửa lỗi. |
| `ERR_NGROK_3200` | Callback owner offline; giữ `DOCKER_ACCEPT_PAYMENTS=false`. |
| Thanh toán chưa có kết quả | Xem trạng thái đơn và callback; không ép PAID hay tạo yêu cầu trả tiền thay thế. |

## 9. Phạm vi bàn giao

Đã build image và chạy giao diện Docker đến bước thanh toán; **VNPAY PAID toàn luồng còn chờ kiểm chứng khi owner online**. Bộ Docker hiện phục vụ demo localhost, chưa phải cấu hình Cloud/production.

Cấu trúc chính: `frontend/`, `backend/`, `docker/`, `Docs/`, `Dockerfile`, `compose.yaml`, `compose.neon.yaml`. Test source dùng Jest/Supertest và Node test runner; không chạy automated financial/database tests trên Neon chung.

Tài liệu bổ sung nằm trong `Docs/`. Hướng dẫn cài đặt hệ thống tham khảo [Docker Desktop Windows](https://docs.docker.com/desktop/setup/install/windows-install/) và [Microsoft WSL](https://learn.microsoft.com/en-us/windows/wsl/install).
