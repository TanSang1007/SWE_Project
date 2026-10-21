# A01 — Authentication, RBAC & Operator Provisioning

Ngày 2026-10-11–12 (Asia/Saigon). **RBAC READY (technical user scope)**. Starting HEAD `97a167a8eee00c1b81e11e418c2f06bd89b3cb5f`; pre-flight chỉ generated `frontend/next-env.d.ts`, SHA256 `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`, giữ nguyên/excluded. PDF đã đọc lại8 trang, SHA256 baseline `08EFC9A6CC247123500419F01160C76712EC773AFFC998D2193F2873EF5312CC`. A01 là USER-APPROVED EXTENSION, không requirement PDF mới; chỉ code A01 được giao. Contract dưới đây được trích trước code và hoàn thiện sau verification.

## Contract trước implementation

| Rule / scope | Source được phê duyệt |
| --- | --- |
| CUSTOMER/STAFF/ADMIN và explicit permission matrix; customer endpoints CUSTOMER only, không impersonation | [A00 §3/13/16](A00_ADMIN_STAFF_CONTRACT.md), D35/D36 |
| UserRole native enum, User.role NOT NULL/default/backfill CUSTOMER, additive migration mới | A00 §4; [Database §10](DATABASE_DESIGN.md); D35 |
| register request email/password only, reject role; login/register public user thêm role; JWT sub/iat/exp không authoritative role claim | A00 §6/13; [B07](B07_AUTH_CONTRACT.md); [API §4/15](API_DESIGN.md) |
| HS256/3600s/bcrypt10/password8..72 UTF-8 bytes/normalized email/memory-only JWT | B07/Q12/D19; không refresh/reset/me/logout server API |
| JwtAuthGuard trước RolesGuard, role từ DB mỗi request, missing/unknown metadata deny403, invalid JWT401 | A00 §3/13/16; test-only harness cho future operator/admin capabilities |
| Manual create-only CLI ADMIN/STAFF, hidden password/confirmation, development opt-in/loopback DB _dev/_test | A00 §13; no production/seed/startup/public registration/upsert nâng quyền |
| Minimal frontend shell tại approved routes, không quản lý nghiệp vụ | A01 user task §5/6; A00 §12; /operator/orders STAFF+ADMIN, /admin/products ADMIN shell only |
| Migration test trước development deploy; existing users/password/balance/ownership/other history preserved | A01 user task §1/9; A00 §4; migration/DB counts+fingerprints evidence |
| Acceptance AS-T01–04, customer B04–B16 regression, frontend role/session/keyboard/responsive and real Edge A–G | A00 §14/16; A01 user task §7–12 |

Không blocker/contradiction. A01 user task explicitly mở rộng phần shell vào phase này; route được A00 phê duyệt vẫn giữ, **A02–A07 business APIs/UI PLANNED**. Default CUSTOMER về `/`, STAFF/ADMIN về `/operator/orders`; admin nav mở shell `/admin/products`; no unavailable feature links, table/form/report/fake data. Đây là shell/auth hint, backend guards là enforcement, không role endpoint mới. AD01 Product.isActive PLANNED A04; AD02 ProductSize/Topping.isActive PLANNED A05; không schema khác trong A01.

## Implemented role schema, auth và permissions

[Migration](../backend/prisma/migrations/20261011230000_user_role/migration.sql) chỉ CREATE TYPE UserRole(CUSTOMER/STAFF/ADMIN) và ADD users.role NOT NULL DEFAULT CUSTOMER. [Schema](../backend/prisma/schema.prisma) thêm đúng enum/field;15 bảng/FK cũ giữ, không Product/Size/Topping flags hoặc Topping/Promotion version. Existing users CUSTOMER, new SQL/Prisma default CUSTOMER; UsersService.register explicit CUSTOMER, DTO không role. Không sửa migration đã apply/reset/delete data.

[UsersService](../backend/src/users/users.service.ts) publicSelect thêm role; [AuthService](../backend/src/auth/auth.service.ts) login/register public user `{id,email,loyaltyPoints,role}` không hash. JWT vẫn đúng sub/iat/exp, HS256/3600s, bcrypt10 policyB07. JwtStrategy lookup DB mỗi protected request; forged extra role claim không authority, đổi role DB có hiệu lực request tiếp theo với token cũ; user thiếu401. Không role/account escalation endpoint.

[Roles](../backend/src/auth/roles.decorator.ts) metadata và [RolesGuard](../backend/src/auth/guards/roles.guard.ts) được AuthModule export. JwtAuthGuard trước RolesGuard; missing/empty metadata/unknown role/wrong-role403 FORBIDDEN; no/invalid/expired JWT401 UNAUTHORIZED. Explicit CUSTOMER bindings trên Cart/Order/Payment/Loyalty; owner checks vẫn trong services. STAFF+ADMIN operator/ADMIN-only permissions kiểm chứng qua isolated test controllers và loopback verification server, không controller mới trong production AppModule. Catalog/health/auth vẫn public, B16 transitionOrder chưa bind HTTP.

| Capability | CUSTOMER | STAFF | ADMIN | A01 implementation |
| --- | --- | --- | --- | --- |
| Existing customer Cart/create/pay/history/loyalty/unpaid-cancel | Owner only | 403 | 403 | Backend enforced |
| Operator shell /operator/orders | Forbidden UI | Có | Có | Shell only, không backend Order list API |
| Admin shell /admin/products | Forbidden UI | Forbidden UI | Có | Shell only, không Product CRUD API |
| Operator/Admin future business permissions | 403 | Operator only | Explicit operator+Admin | Reusable guard/harness; A02–A07 PLANNED |

Official API reference: [Nest11 authorization](https://docs.nestjs.com/v11/security/authorization); implementation dùng existing Nest guards/Reflector, không cài authorization package/upgrade stack. [Prisma7 enum/default](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference) phù hợp schema hiện tại.

## Operator provisioning CLI — IMPLEMENTED

`npm.cmd run provision:operator --workspace backend -- --role ADMIN` hoặc STAFF gọi [standalone script](../backend/scripts/provision-operator.cjs), không AppModule/seed/startup/install hooks. NODE_ENV=development + explicit ALLOW_OPERATOR_PROVISIONING=true, DB PostgreSQL loopback _dev/_test; production/remote/other DB/missing opt-in reject. Email interactive normalize B07, password hidden raw terminal + confirmation,8..72 UTF-8 bytes/no trim/bcrypt10; password argument/noninteractive input rejected. Output chỉ ID/role hoặc generic error, no DSN/password/hash/JWT. finally clear credential references/close connection/restore terminal. Immutable JS strings không phải cam kết memory zeroization.

One PostgreSQL BEGIN/INSERT user UUID/email/hash/explicit STAFF|ADMIN/COMMIT; rollback on fault,23505 EMAIL_ALREADY_EXISTS giữ role/password/balance/relations cũ, không upsert/promote. Helper cùng validation/env gating dùng trong actual CLI/PostgreSQL/browser fixtures; duplicate/concurrency/trigger-fault tests verified. No default operator account, credentials không lưu repository; developer chạy command thủ công để tạo tài khoản thật khi cần.

## Frontend auth và minimal operator shell — IMPLEMENTED

Role PublicUser/parser whitelisted, missing/invalid role rejected. Memory JWT/lifetime/logout/reload policyB07 giữ; role-aware safe returnTo blocks external/auth loops và role-incompatible private paths. Default CUSTOMER `/`, STAFF/ADMIN `/operator/orders`; ADMIN nav `/admin/products`. Shell layouts loading/hydration/auth-checking, guest login link, forbidden alert, role-specific nav và existing logout; no upcoming-feature links như đang hoạt động, no table/CRUD/report/fake data. Shared layout responsive390/768/1366/native44px links/focus/keyboard.

Cart cache clears on token/user/role switch; no automatic Cart request for operators. Stateless shell có no user-specific cached data. Logout/expiry clears role/JWT/UI; new user discards previous checkout/payment transport contexts. Same-owner uncertain transport context giữ nguyên qua logout/re-login để B10/B11 lost-response recovery không duplicate; context không chứa JWT và không authority. Backend luôn enforce permission; shell role là last-login hint, DB role changes có thể khiến UI hint cũ tới re-login nhưng không bypass API. Không thêm me/role endpoint/refresh token/persistent JWT.

## Migration verification trước và sau development apply

New [PostgreSQL suite](../backend/test/database/rbac.spec.ts) apply chỉ hai migration cũ, tạo representative legacy data đủ15 bảng/password hash/loyalty5/PAID Order/Payment/award/Cart/options/promotion/claims. Apply role migration rồi compare complete-row fingerprints bỏ field role mới, FK definitions, hash/balance/ownership/native enum/default/NOT NULL.15/15 PASS **trước** development deploy.

Development snapshot before deploy:2 existing users,15 bảng. Apply bằng `npm.cmd run db:migrate:deploy`; then exact fingerprints/FK compare PASS, cả2 users CUSTOMER, password hashes/balances/ownership/timestamps/history/catalog giữ nguyên. Sanitized development evidence (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)).3 migrations up to date. Không reset/delete public data hoặc provision actual operator account vào development ngoài fixtures được cleanup.

## Verification plan trước code

- Migration role additive, kiểm chứng legacy migration/backfill trong UUID schema trước apply development; no reset/applied-migration edits.
- Existing AuthModule/UsersService/JwtStrategy reused; explicit CUSTOMER guard metadata trên Cart/Order/Payment/Loyalty, public Catalog/health/auth giữ public; internal B16 không exposed.
- CLI `npm run provision:operator --workspace backend -- --role ADMIN` (hoặc STAFF), interactive email/hidden password+confirm; opt-in `ALLOW_OPERATOR_PROVISIONING=true` và NODE_ENV=development/local _dev/_test.
- Auth response/client model role; role-aware safe redirect, memory/expiry/logout/cache isolation; minimal shell guest/forbidden/loading states.
- Security/PostgreSQL/CLI/Frontend tests, full lint/build/default/integration regression, Prisma format/validate/generate/status, Edge customer regression + operator A–G; sanitized evidence, no credential records.

## Actual tests và evidence

| Command / check | Observed result |
| --- | --- |
| npm.cmd run test --workspace backend | 9 suites159/159 PASS, baseline145 +14 A01 guard/CLI groups |
| npm.cmd run test --workspace frontend | 103/103 PASS, baseline93 +10 A01 parser/navigation/shell/session groups |
| npm.cmd run test:database --workspace backend | 12 isolated suites278/278 PASS, baseline263 +15 A01 migration/RBAC/CLI cases; no tests disabled |
| npm.cmd run lint / npm.cmd run build | Both Next/Nest PASS, no dependency version change |
| npm.cmd run db:format / db:validate / db:generate / db:status | PASS;3 migrations up to date, only UserRole/User.role change |
| npm.cmd run test:rbac:browser --workspace frontend | Compiled Next3000/Nest3001/PostgreSQL + Edge155.0.4283.45 PASS, full customer regression + A01 A–G |

Security cases: role injection register ADMIN/STAFF400/no user, all3 role logins and wrong-password401, exact public projection/no hash, auth401 vs role403/default-deny metadata, fake signed role/header/query/body ignored, DB role demotion with same token, owner404, production no operator/debug/status/escalation routes. CLI gates/password byte boundaries/hidden echo/raw-mode cleanup/production actual executable/no secret logs/duplicate no promotion/rollback/concurrent one-create. [Unit guard](../backend/test/roles.spec.ts), [CLI tests](../backend/test/provisioning.spec.ts), [PostgreSQL](../backend/test/database/rbac.spec.ts), [frontend](../frontend/test/rbac.test.mjs).

Sanitized regression summary (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)). Browser/network/evidence (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)): A customer register/login; B customer operator403/forbidden shell; C Staff operator200/shell; D Staff Admin403/forbidden shell/no admin link; E Admin both shells200; F logout/re-login/account isolation and reload loses session; G role injection/no public escalation/forged claim denied. DB role change tested with old token. Guard probes separate loopback-only server never AppModule; production counterparts404. Admin shell390/768/1366 no overflow/44px links/native keyboard, 390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)); images visually reviewed. Existing B06–B15 flows include Cart/edit/Order/payment retry/lost responses/Promotion snapshots/Loyalty/history/ownership/read-only fingerprint checks, A01-prefixed artifacts giữ B06–B16 evidence cũ. B16 graph/workflow/stock/loyalty reversal regression chạy PostgreSQL; không fake browser workflow A02/A03. Fixture customers/operators/history/promotions removed, original catalog/config/history retained.

## Issues, scope/security review và checkpoint

First frontend role-missing test used helper default CUSTOMER for undefined; fixture fixed/strict parser preserved. First PostgreSQL security test nested login inside Supertest request construction closed temporary server; moved login before request, no application change. Lint required credential cleanup as object references rather than unused variable assignments. Migration rename left an empty task-created directory: first deploy applied role but Prisma then P3015 on empty directory; removed exactly that empty un-applied path and deploy/status/metadata verified3 migrations. First browser A–G passed but parent customer cleanup expected Cart after helper returned to menu; helper restored client Cart route, complete E2E rerun PASS. Assertions remain enabled.

Security review reproduced pg URI `?host=` overriding nominal loopback hostname without opening a connection. CLI gate now checks both URI và effective pg Client host/database; remote/socket override rejected in security tests before connect. No new connection/role feature. Known pg concurrent-query deprecation non-failing; D33 worker recycling retained, no native exit in completed278-test run. Existing dependency advisory triage remains, no install/upgrade/lockfile change or claim audit clean. Human manual QA/Firefox/NFR01/team review/full DoD/B17/Compose still pending. Logout local/token remains valid to exp, DB permission next-request semantics giữ B07/A00; no stronger revocation claim.

A02–A07 business APIs/UI PLANNED; AD01/AD02 lifecycle migrations stay A04/A05. Source engine B09/B10/B11/B13/B15/B16 unchanged, no product/stock/promotion CRUD, no public Order transition/provision/role-management endpoints. Explicit local commit message `feat: implement BrewLite admin staff RBAC`; hash reported from Git after commit, no remote/push/global config. next-env restored to pre-flight bytes after build and excluded. Recommended next task: A02 Operator Order Management UI khi được giao riêng.
