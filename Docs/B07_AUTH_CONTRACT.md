# B07 — Authentication contract

**A01 addendum, 2026-10-11:** historical B07 no-role response/evidence bên dưới được mở rộng theo A00/D35/D38 bằng User.role DB và public user.role trong register/login; guards/CLI/shell/security tại [A01](A01_RBAC_AUTH_CONTRACT.md). B07 JWT/HS256/3600s/password/bcrypt/email/memory policy giữ nguyên. Public register rejects role/always CUSTOMER; old forged JWT role không authority; no new auth/privilege/debug API. No-role/no-schema statements below describe B07 checkpoint, không current A01 state.

Trích trước code từ [API_DESIGN §4](API_DESIGN.md#4-auth), REQUIREMENTS FR04/FR05, DECISIONS Q12/D19. Không endpoint hoặc role mới.

| Endpoint | Method | Request | Response | Requirement ID |
| --- | --- | --- | --- | --- |
| /auth/register | POST | {email,password} | 201 {user:{id,email,loyaltyPoints}}; 400 VALIDATION_ERROR; 409 EMAIL_ALREADY_EXISTS | FR04 |
| /auth/login | POST | {email,password} | 200 {accessToken,tokenType:"Bearer",expiresIn:3600,user:{id,email,loyaltyPoints}}; 400 VALIDATION_ERROR; 401 INVALID_CREDENTIALS | FR05 |

Email trim/lowercase, tối đa254 ký tự. Password 8–72 UTF-8 bytes, không trim/truncate; bcrypt cost10. JWT HS256, sub=user UUID, iat/exp, lifetime3600 giây. JWT_SECRET env, không source/log/commit. JWT_EXPIRES_IN env mặc định3600 và reject giá trị khác theo baseline đã khóa. Không refresh/session table/OAuth/verification/reset/me/logout API. Logout local clear memory, không revoke JWT trước exp. Customer duy nhất, không DB role/RBAC.

Guard foundation dùng Passport JWT verify signature/HS256/expiry + validate UUID sub/exp và tồn tại user, request.user chỉ public fields. Chưa protected business endpoint nào trong scope; guard test endpoint chỉ được đăng ký trong test harness, không AppModule production. Register không auto-login; UI /register→/login, login về returnTo nội bộ an toàn hoặc menu khi chưa có checkout/cart. Token/user memory qua Zustand, reload login lại; TTL timer clear local state.

Implementation references: [Nest Passport recipe](https://docs.nestjs.com/recipes/passport), [bcrypt maintained library](https://github.com/kelektiv/node.bcrypt.js). Dùng nhánh Nest11 theo baseline; không lấy tutorial auth mới để tự mở rộng endpoint/session/role.

## Implementation and evidence — 2026-10-07

Backend AuthModule/UsersModule dùng PrismaService hiện có, không schema/migration mới. DTO transform email + class-validator kiểm tra8–72 UTF-8 bytes (không chỉ JS length). users.password_hash bcrypt10; create select public fields. P2002→409 EMAIL_ALREADY_EXISTS xử lý cả concurrent register. Login invalid email/password cùng401/message; unknown email vẫn bcrypt compare với dummy hash runtime. JWT chỉ sub/iat/exp; signature, exp, algorithm whitelist, sub UUID và user existence được Passport strategy kiểm tra. HttpExceptionFilter giữ envelope và hỗ trợ code explicit đã có trong API_DESIGN; lỗi server500 vẫn sanitize. Public Catalog/health không bị guard global.

Frontend `/register`, `/login`, API layer env-based, Zustand memory token/user/expiresAt, expiration timer và getAccessToken clear expired state. Validation/form loading/error/status/redirect; safe returnTo chỉ local path, không external/auth loop; password không trim. Register→login, không auto-login. Login về return path/menu; checkout/cart chưa implement nên không dựng route giả. Logout local clear, reload mất token, không cookie/localStorage/sessionStorage/persist. Auth requests timeout5s theo config baseline; AbortController khi unmount.

Exact dependencies: @nestjs/jwt11.0.2, @nestjs/passport11.0.5, passport0.7.0, passport-jwt4.0.1, bcrypt6.0.0; dev types passport-jwt4.0.1/bcrypt6.0.0; lockfile update. Không upgrade framework major. npm audit snapshot vẫn29 entries (20moderate/9high), omit=dev4high từ Prisma CLI/config/deepmerge-ts/mysql2 đã triage B03; không advisory mới ở auth packages, không audit fix/force hoặc tuyên bố audit sạch.

Tests: 16 auth PostgreSQL tests PASS trong schema riêng; gồm register/no-auto-login/bcrypt10/normalization/duplicate/concurrent/DTO/UTF-8 boundary/login/payload/no leak/guard valid/missing/invalid/expired/wrong-signature/algorithm/no-exp/absent-user. Database total69/69 (34B04+19B05+16B07), backend default16/16 (15previous+1JWT env validation). Frontend23/23 (13B06+10auth), lint/build hai workspace PASS. Prisma validate/generate/migrate status PASS; metadata/checksum/seed-count verifier PASS sau fixture cleanup.

Browser evidence (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)): Edge154, frontend3000 hiện có được giữ nguyên; lượt cuối harness chạy backend production3001 do backend trước đó đã dừng, cleanup đúng process nó tạo. Register fixture account random, DB hashbcrypt10, login invalid401/success200, client authenticated state, no token storage, logout clear, re-login rồi reload mất memory PASS. Guard200/401 được gọi trong browser trên **verification-only server port riêng, loopback-only**, cùng code AppModule/PrismaService/JwtAuthGuard; production __auth_verify vẫn404. Không protected business/me endpoint mới. User fixture chỉ của lượt test đã cleanup; credentials/token/hash chỉ transient runtime, không report/log/commit. B06 responsive/menu/detail/refresh/states cũng PASS trong flow này; screenshots/evidence B06 historical được giữ nguyên.

JWT_SECRET local được generate nếu chưa có, .env ignored; sample secret bị validation từ chối. Helper `node backend/scripts/configure-auth-env.cjs` chỉ setup development, giữ secret đã cấu hình và không in giá trị; deployment cấp secret từ environment. JWT_EXPIRES_IN=3600 theo D19, không business TTL mới. Root .env/example không có credential thật trong Git.

Kết quả kỹ thuật: AUTH READY. Full DoD/review nhóm chưa evidence; NFR latency/Firefox/checkout/ownership business endpoints vẫn các task sau. Không claim JWT server-side revocation: logout chỉ local, JWT còn valid tới exp theo baseline. Không chuyển sang Cart.
