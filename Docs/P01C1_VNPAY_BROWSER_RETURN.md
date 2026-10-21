# P01-C1 VNPAY BROWSER RETURN RESULT

2026-10-17. Baseline `8e94b84e6c3f5e233a57a5cb646c63b5bd5bde4a`.
Authority: user-approved backend-only implementation of
[P00 §11](P00_VNPAY_SANDBOX_PAYMENT_CONTRACT.md#11-return-url-và-session-recovery).
Frozen decisions, schema and financial engines remain unchanged.

## Route and safe redirect

Public GET `/payments/vnpay/return`, no JWT/session requirement.
[Controller](../backend/src/payments/browser-return.controller.ts) reads original
raw query, calls only [resolver](../backend/src/payments/browser-return.service.ts),
returns303 See Other with empty body, `Cache-Control:no-store`,
`Referrer-Policy:no-referrer`.

Valid signature and bound context →
`http://localhost:3000/payments/vnpay/result?attemptId=<uuid>`.
Invalid/unknown Return, gateway gate-OFF or unavailable context → same generic URL
without query. No amount, user/Order ID, status code, signature, signed URL, provider
Message, JWT or sensitive evidence. Provider outcome is never authoritative here.

[Redirect helper](../backend/src/payments/vnpay/return-redirect.ts) reuses existing
server FRONTEND_ORIGIN only when exactly `http://localhost:3000`, with fixed result
path. No arbitrary RESULT_URL env switch. Host/Forwarded headers/body/next/returnUrl
cannot select destination. Alternate host/port/protocol/credentials/path/query/
fragment is rejected. Missing/invalid server origin returns sanitized503 without
Location: a technical fail-closed condition, not a redirect to untrusted config.
Under valid config, invalid provider input follows P00 generic303.

Framed GET/HEAD bodies are scrubbed before JSON parsing, including malformed/oversized
JSON and case/trailing-slash route spelling. They return generic303 without lookup;
bad origin still503/no Location. Existing IPN body/ACK branch is unchanged. No raw
provider data is rendered in HTML; the redirect body is empty.

## Verification and attribution

Reuse pure P01-A/P01-B2B `authenticateIpn`, `verifyPayCallback` and Sandbox config
validator, not IpnService execution. Raw8KiB/30-key limits, single decoding, duplicate
decoded keys, malformed percent/UTF-8, arrays/nested/unknown keys, empty/control values
and unsupported hash types are rejected. PAY whitelist/required fields stay frozen.
HMAC-SHA512 uses pinned PAY canonical encoding, hex128/64 bytes and timingSafeEqual;
no downgrade/alternate signature format. Signature/merchant authenticated before DB.

After known ref lookup, validate VNPAY_SANDBOX/merchant/ref/currencyVND and exact
immutable minor amount against Attempt and Order total. No divide/round/reprice.
Bind original PAY snapshot command/version/currency/merchant/ref/minor/CreateDate,
configured Return URL and matching OrderInfo. Original completed201 PAY_ORDER claim
must match owner/Order, VNPAY_INITIATE_V1 hash and response attemptId/orderId/provider.
Only a validated stored UUID can become navigation context; never guess one.

Existing callback syntax/date/transaction-number checks run, but the helper's
outcome is deliberately ignored. Valid success/failure/UNKNOWN/contradictory codes
do not change local state through Return. Unknown ref, bad signature/amount/context,
missing/invalid gateway config or DB failure all resolve generic, with no raw logs.
Local expiry does not reject navigation or release reservations.

## Read-only guarantee and Return versus IPN

Resolver injects only PrismaService/ConfigService. No IPN/QueryDr/zero/Mock/initiation
service dependency, settlement call, provider HTTP or retry. Lookup is bounded
RepeatableRead (maxWait50ms/timeout400ms), explicitly **SET TRANSACTION READ ONLY**
before first lookup; no row locks/DML. Failure establishing READ ONLY stops lookup.
PostgreSQL rejects DML in this transaction. This is a read snapshot, not financial T2.

Return never creates/updates Attempt, Verification, Payment, Order, Award, Loyalty
journal/balance/debt, Inventory stock/version, Cart or idempotency. Unit tests use
forbidden-service spies; integration compares every table and sequence fingerprint
before/after Return. These checks include valid/invalid/repeated callbacks, expiry,
Return before/after IPN and UNKNOWN/REVIEW.

Before IPN, even signed00/status00 leaves Order PENDING and resources held. Signed
decline also leaves it PENDING. Only genuine IPN/QueryDr may apply provider outcome.
After applied success/failure, Return still only navigates; no duplicate settlement.
Return/IPN races preserve one financial effect set. An old failure's success Return
cannot consume a newer retry's held points or clear REVIEW/UNKNOWN.

Browser identity is ignored by this public resolver. A valid signed callback may
resolve its opaque context without login, but reveals no customer details. Existing
owned status GET remains JWT-protected and cross-owner404; tests verify both. This
implements P00 public resolver/private status architecture, not a public detail API.

## Feature gate and local limitations

Default mode MOCK and synthetic-isolated VNPAY startup gate remain unchanged.
MOCK Return goes generic without DB lookup or merchant credentials, never calls
Mock as fallback. QueryDr default transport remains disabled; external response
compatibility **PENDING**. No actual merchant secret/config changes or VNPAY calls.

Frontend currently has no `/payments/vnpay/result` page. C1 implements backend303
only; following Location against today's frontend can404 until C2 adds the page.
No frontend edits or completed result-browser experience are claimed. Localhost
works only in a browser on the BrewLite machine, not public/mobile deployment.
Ngrok/HTTPS ingress/registration/TLS/merchant setup remain separate tasks; none run.

## Remaining P01-C2 prerequisites

- Public generic result/login route; only authenticated owned status GET can show
  Order/amount/outcome. Full-page redirect loses memory JWT; no JWT/provider payload
  in URLs and no token persistence shortcut.
- Pending before IPN; success only after local applied state; confirmed failure
  actions from capabilities; UNKNOWN without unsafe retry and REVIEW without force-paid.
  Bounded polling/session/account-switch behavior must follow P00; no Customer QueryDr.
- Checkout integration for positive initiation and explicit zero confirmation;
  primary label/keys/session retry context and sanitization follow frozen P00.
- Separately authorized callback ingress/merchant/profile/signature/actual Sandbox
  validation; QueryDr live canonicalization still requires representative actual
  signed responses or explicit VNPAY optional-field confirmation.

Actual VNPAY Sandbox E2E: **NOT RUN**. No Checkout UI, Return page, tunnel, deployment,
activation, Refund or push in this task.

## Verification and final23-item report

**P01-C1 COMPLETE — READY FOR CHECKOUT UI**.

| Mục | Kết quả đã kiểm chứng |
| --- | --- |
| 1. Git baseline | `8e94b84e6c3f5e233a57a5cb646c63b5bd5bde4a`, khớp expected |
| 2. Files changed |14 files:7 backend,6 Docs,README; no frontend/schema/env edits |
| 3. Return endpoint | Public GET /payments/vnpay/return;303; no JWT/session |
| 4. Query validation | Raw parser8KiB/30 keys, duplicate/percent/UTF-8/nested/unknown/body rejection PASS |
| 5. Signature | Existing HMAC-SHA512/timingSafeEqual profile unchanged, no downgrade |
| 6. Merchant/Attempt | Signature before lookup; merchant/ref/minor/context/claim binding; unknown/mismatch generic |
| 7. Destination | http://localhost:3000/payments/vnpay/result with at most attemptId UUID |
| 8. Open redirect | Host/Forwarded/URL input ignored; invalid server config503/no Location; no raw provider/JWT leakage |
| 9. Read-only | READ ONLY transaction before lookup, no financial dependencies/DML; all-table/sequence fingerprints before/after match |
| 10. Before IPN | Success/failure Return leaves PENDING/resources; signed outcome ignored |
| 11. After IPN | PAID/PAYMENT_FAILED untouched; repeated Return has zero effects; race settles once via IPN |
| 12. UNKNOWN/REVIEW | No bypass, release/retry/auto-clear or newer reservation consumption |
| 13. Feature gate | Normal MOCK/gateway OFF unchanged; synthetic isolated testing only; no actual merchant secret/network |
| 14. Compatibility | All667 backend/667 PG baseline test names retained and PASS; prior financial source hashes unchanged |
| 15. Backend tests |24 suites/728 tests PASS, including61 new Return unit/HTTP |
| 16. PostgreSQL |25 suites/692 tests PASS, including25 new Return cases; isolated database clone/UUID schemas |
| 17. Frontend |191 tests PASS; source untouched; production build uses source copy |
| 18. Tooling | Prisma validate/status/diff PASS/no drift; both lint/typecheck/build PASS |
| 19. Development | READ ONLY pre/post13 migrations/checksums/19 fingerprints/catalog/functions/sequences unchanged |
| 20. Remaining blockers | No backend implementation blocker; frontend result page/Checkout and external Sandbox prerequisites remain pending |
| 21. Git status | Scope only; next-env remains pre-existing modified, byte-exact and excluded |
| 22. Local commit | Authorized after checks/review PASS; SHA reported in final response/Git history, no self-embedded SHA |
| 23. P01-C2 readiness | Ready for separately assigned result/login/Checkout UI; not automatically started |

Machine evidence (evidence kiểm thử cũ đã dọn) records source hashes, test/check exits,
baseline-name conservation and before/after development fingerprints/migration checksums.
Test queries fingerprint every table and sequence in the isolated schema around
Return; intentional IPN settlement races are additionally checked for exactly one
Payment/Award/SETTLE or RELEASE/Cart/stock effect set. No exactly-once network claim.
Unit forbidden-service spies ensure Return does not execute financial services.

Secret/private-key scan, local links/anchors, Git diff whitespace/scope, previous
financial engine source preservation and exact next-env SHA256 PASS. No baseline
tests removed/skipped. Existing pg concurrent-query deprecation notices and expected
negative503 logs do not represent failed assertions. Actual Sandbox E2E **NOT RUN**.
