# B05 — Catalog contract and verification

Trích trước implementation từ [API_DESIGN.md §3](API_DESIGN.md#3-catalog), [REQUIREMENTS](REQUIREMENTS.md) FR01/FR02; database mapping theo B04 audit (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)). Không thay contract.

| Endpoint | Method | Params | Response | Requirement ID |
| --- | --- | --- | --- | --- |
| /products | GET | Không query/path params | 200: {items: [{id,name,price,imageUrl,available}], currency: "VND"}; empty items=[] | FR01 |
| /products/:id | GET | id UUID; không query params | 200: {id,name,price,imageUrl,available,sizes:[{size,extraPrice}],toppings:[{id,name,price}]} | FR02 |

Public read-only, không JWT/auth logic. Không category/description vì baseline không field đó; không endpoint sizes/toppings riêng. Không filtering/search/pagination/query parameters. ID sai 400 VALIDATION_ERROR; product không tồn tại 404 NOT_FOUND theo filter hiện có. Query ngoài contract 400 VALIDATION_ERROR theo whitelist. Errors: {error:{code,message,details,requestId}}; lỗi DB bất ngờ được filter sanitize thành 500 INTERNAL_SERVER_ERROR, không raw SQL/Prisma/URL/stack.

API không quy định sort bắt buộc; implementation dùng product ID ASC, topping ID ASC và size S/M/L để deterministic, không sort/filter API mới. available = stock > 0 theo tồn Product trực tiếp; không trả stock/version/timestamps, không reserve/decrement stock. imageUrl giữ đường dẫn /images/... thuộc frontend origin; assets/UI ngoài B05.

PrismaService duy nhất được inject vào CatalogService. findMany select các field list, findUnique nested select ProductSize/ProductTopping.topping theo product. Giá DB Decimal(12,0) serialize bằng toFixed(0), không Number/parseFloat. Detail không wrapper items/currency mới vì contract chỉ item fields + options.

## Evidence

Kết quả kỹ thuật: CATALOG READY. 4 service + 15 HTTP tests dùng PostgreSQL thật/schema `brewlite_b05_test_<UUID>` riêng PASS; fixture values khác seed chứng minh không hard-code giá/options, tiền max 999999999999 vẫn là chuỗi. Seed B04 được chạy trong schema test để so sánh contract, không thay seed development. 3 error-boundary tests PASS (500 list/detail sanitized; UUID sai không query).

Regression: backend lint/build/default tests 15/15 PASS; database suite 53/53 PASS (34 B04 + 19 Catalog). Prisma validate/generate/migrate status PASS; frontend lint/build PASS. Thay đổi `frontend/next-env.d.ts` đã có trước B05 được giữ nguyên và không thuộc checkpoint.

Manual smoke evidence (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)): backend compiled `dist/main.js`, PostgreSQL seed B04, own temporary local port; list/detail 200, missing404, UUID/query400, POST404. Giá products 45000/40000, size 0/5000/10000, topping 5000/7000, stock/version/timestamps không đổi; process smoke đã dừng, schema tests đã cleanup.

Scope/security review: runtime chỉ hai @Get + Prisma findMany/findUnique; không mutation/raw SQL/new PrismaClient/auth bypass/credential. Schema/migration/seed/API_DESIGN/REQUIREMENTS/PDF không sửa. Review nhóm theo toàn DoD chưa evidence; B05 parent giữ unchecked, không dựng review event. NFR <500 ms/UI/assets/browser thuộc task sau.
