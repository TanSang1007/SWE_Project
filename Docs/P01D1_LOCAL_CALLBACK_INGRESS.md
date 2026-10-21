# P01-D1 LOCAL CALLBACK INGRESS RESULT

2026-10-18. **P01-D1 INFRASTRUCTURE COMPLETE — ACTIVATION BLOCKERS REMAIN**.
Baseline HEAD: `1f1aa4a3c7430ccd012eadca43903c011a29a79f`.
Initial working tree: only unrelated `frontend/next-env.d.ts` modified; retained
byte-exact and excluded. Scope: P00 D06 local adapter/binding, synthetic verification
and readiness audit. No real gateway, tunnel, merchant activation or deployment.

## Local architecture and implementation

```text
Customer browser -> Next http://localhost:3000 -> Nest http://127.0.0.1:3001
Future approved HTTPS domain -> callback ingress http://127.0.0.1:3102
                                             -> Nest http://127.0.0.1:3001
Nest Return303 -> http://localhost:3000/payments/vnpay/result[?attemptId=UUID]
```

[Server](../backend/src/callback-ingress/server.ts) uses Node built-in HTTP only;
[launcher](../backend/src/callback-ingress/main.ts) starts a separate foreground
process with fixed127.0.0.1:3102 and upstream127.0.0.1:3001. No package install,
service manager, firewall change, static files or new Nest API.
[Nest bootstrap](../backend/src/main.ts) now explicitly binds127.0.0.1; its PORT
continues to come from validated ConfigService (default3001). No trust-proxy change.
Frontend, financial engines, Prisma schema and13 migrations remain unchanged.

| Ingress route/method | Behavior |
| --- | --- |
| GET `/payments/vnpay/ipn` | Forward only to same raw target at fixed local Nest |
| GET `/payments/vnpay/return` | Forward only to same raw target at fixed local Nest |
| Other path |404, including case/trailing-slash/encoded-path variants |
| Other method on allowed path |405, Allow GET |
| CONNECT / WebSocket upgrade |405, no upstream connection |
| Absolute-form, network-path, fragment/backslash/control target |400 |
| Framed GET body / Expect |400, no upstream; strict parser also rejects CL+TE ambiguity |
| Oversized target / parser header overflow |414 /431 |
| Upstream unavailable/truncated/oversized/invalid redirect |502, safe fixed text |
| Upstream absolute deadline exceeded |504, safe fixed text |

Errors do not echo query, headers, destination, secrets or internal exception.
Ingress never invents IPN JSON/success ACK. Its502/504 are transport failures,
not provider business outcomes or evidence that an Order failed.

## Raw query and response forwarding

Path allowlist checks only the exact prefix before `?`; outgoing HTTP `path` is
the original Node request target. There is no URLSearchParams/decoding/re-encoding,
sorting, duplicate removal or signature edit. `+`, `%20`, percent casing, nested
percent escapes, percent-encoded Unicode and even malformed percent values pass
unchanged to Nest, where existing strict parser/HMAC rejects invalid callbacks.
Non-ASCII raw target bytes are rejected; percent-encoded Unicode is preserved.

IPN status and complete body bytes are preserved, including non-success RspCode and
Message. Content-Type/Content-Encoding are retained; Content-Length reflects the
same buffered entity bytes. No retries/follow-redirect/replay are added by ingress.
Return303, empty body, Referrer-Policy and fixed Location are retained verbatim.
As a defense at this boundary, a Location outside C1's exact local result route
and optional UUID, or a Location on a non303/non-Return response, fails502 instead
of relaying an unapproved redirect. Backend remains the navigation-context verifier.

All responses/errors use no-store and connection close. No CORS headers, Set-Cookie,
Authorization challenges, proxy headers or other unrelated upstream headers are
relayed. Requests use fresh Host/Accept/Connection only: client Authorization,
Cookie, Origin, Host, Forwarded/X-Forwarded-* do not reach upstream or change
authority. HMAC remains mandatory in Nest; no Basic Auth/IP/User-Agent substitute.

## Bounds and operational limitations

- Raw request target8192 bytes; HTTP parser headers16384 bytes (includes framing).
- Upstream headers16384 bytes; buffered response65536 bytes; absolute upstream5s
  deadline includes response body, not just an idle socket timeout.
- Request/header timeouts5s with Node's1s connection-check interval; keepalive1s,
  one request/socket, maximum64 simultaneous inbound connections.
- No request/access logging in server; launcher emits only fixed lifecycle/error
  messages. Do not enable external raw HTTP debug/trace logging for callbacks.
- Test factory accepts only validated loopback port/shorter timeout overrides for
  isolated tests. Production launcher exposes no upstream host/port env/CLI switch.
- This is a small local demo adapter, not a production DDoS/HA/load-certification
  claim. Backend idempotency/verification, not ingress transport, ensures effects.
- Return localhost destination works only in the browser on the BrewLite machine.
  Mobile viewport tests are not support for a physical remote phone using localhost.

## PowerShell local-only operation

From `D:\CNPM`, after an operator has prepared the ordinary local backend/database:

```powershell
npm.cmd run build --workspace backend
npm.cmd run start --workspace backend
```

Use a separate terminal for the callback-only process:

```powershell
npm.cmd run start:callback-ingress --workspace backend
```

Do not start a second backend if3001 is occupied; keep the existing process and
coordinate any operator restart. D1 did not stop/restart the user's backend.
Ctrl+C stops the owned foreground ingress; no background service is installed.
Binding review can use this read-only command:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3001,3102 |
  Select-Object LocalAddress,LocalPort,State
```

Local unsigned smoke requests (never include a real signed query in a command log):

```powershell
curl.exe -i http://127.0.0.1:3102/admin
curl.exe -i http://127.0.0.1:3102/payments/config
curl.exe -i -X POST http://127.0.0.1:3102/payments/vnpay/ipn
curl.exe -i http://127.0.0.1:3102/payments/vnpay/ipn
curl.exe -i http://127.0.0.1:3102/payments/vnpay/return
```

Expect404,404,405; in ordinary MOCK, IPN200/RspCode99 and generic Return303.
Missing-field unsigned input is99, while syntactically complete bad-signature
input is97 in enabled synthetic mode. Do not require97 from every empty request.
These outcomes establish routing only; no merchant registration/settlement proof.

## Configuration compatibility

The root [.env.example](../.env.example) retains default MOCK and commented sample
merchant/callback values; no `.env`/credential value is changed in D1.

| Setting | Current/future meaning |
| --- | --- |
| PAYMENT_PROVIDER_MODE |MOCK default; VNPAY_SANDBOX remains test-gated |
| VNPAY_ENV / VNPAY_VERSION |Future SANDBOX /2.1.0 only |
| VNPAY_TMN_CODE / VNPAY_HASH_SECRET |Merchant-issued, private local configuration after rotation/approval; no values collected here |
| VNPAY_PAYMENT_URL |Pinned `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` |
| VNPAY_RETURN_URL |Future approved HTTPS domain + `/payments/vnpay/return` |
| VNPAY_IPN_URL |Same HTTPS origin + `/payments/vnpay/ipn`, separately registered with VNPAY |
| VNPAY_RESULT_URL |Documented expected local destination only; NOT a runtime URL override |
| FRONTEND_ORIGIN |C1 requires exactly `http://localhost:3000`; fixed result path |

No `vnp_IpnUrl` PAY parameter is added. Website registration identifies the
merchant site; Return is browser navigation; IPN is the server callback. A domain
entered as Merchant Website URL is not evidence that the IPN URL is registered.
VNPAY instructs the merchant to provide IPN separately and requires HTTPS; Return
does not update payment state. [Official PAY integration](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html).

## Provider activation preflight

[initiationSettings](../backend/src/payments/vnpay/initiation-config.ts) is unchanged:

1. Absent mode defaults MOCK, no merchant credentials parsed.
2. VNPAY requires NODE_ENV=test, explicit synthetic flag, matching local isolated
   database URLs, reserved test DB naming, TEST0001/synthetic secret and approved
   fixture callback host. Invalid/missing mode/config fails closed.
3. Development/production + real merchant values cannot initiate. Editing `.env`
   to select VNPAY is not an activation procedure; startup rejects it.
4. GET /payments/config revalidates that same gate and503s when unready; there is
   no frontend-only switch or fallback. QueryDr default transport is still disabled.

Future activation needs a separately approved minimal gate/config-discovery change
for a controlled local merchant session, keeping production denied, fixed Sandbox
destinations, loopback API and safe callback host binding. Its exact opt-in/config
contract, credential rotation/drain and minimum policy must be reviewed/tested first.
No new opt-in flag or alternative workflow is implemented or assumed approved here.

## Minimum provider amount audit — ACTIVATION BLOCKER

**ACTIVATION BLOCKER — MINIMUM PROVIDER AMOUNT POLICY REQUIRED**.

The official FAQ currently states a5,000 VND minimum. P00 §5 explicitly left the
merchant minimum as an activation gate; it did not select a business response for
1–4,999 VND. [Official VNPAY FAQ, checked2026-10-18](https://sandbox.vnpayment.vn/apis/docs/faqs/).

| Immutable finalTotal | Current behavior and readiness |
| --- | --- |
|0 VND |Existing explicit internal confirmation; Payment0/Award0/EARN0, no Attempt/gateway |
|1–4,999 VND |Order creation still allowed; current synthetic initiation creates exact positive Attempt/URL. No runtime minimum guard exists. NOT allowed to activate/send these requests live before policy approval. Positive confirm-zero rejects422. |
|≥5,000 VND |Fits published minimum, subject to existing numeric ceiling9,999,999,999 VND, merchant/bank limits and all activation gates; no actual acceptance claim |

No charge is rounded/increased, no Promotion/Loyalty/Order snapshot is changed, no
new Order-creation rejection or Mock fallback is introduced. Synthetic tests record
the gap without navigating to VNPAY.

Options for a separate user decision (none selected):

- **A — reject gateway initiation below minimum**, with a clear unsupported-amount
  UI/error before an Attempt is committed; preserve Order creation. Customer may
  explicitly cancel the pending Order to release stock/points, then create a new
  Order with an eligible selection. Immutable Order is never repriced.
- **B — define an explicit eligible redemption/checkout selection policy** so the
  Customer chooses total0 or≥5,000 before creation. Requires Loyalty/preview/UI
  contract review and treatment of Promotion-only subtotals; no silent point clamp.

Either needs approved semantics and tests before enable. Option B is a broader
business change; it is not authorized by this infrastructure task.

## ngrok preparation — NOT RUN

[Placeholder YAML](../ops/ngrok-callback.example.yml) uses version3, only one
endpoint named brewlite-callback, with upstream exactly loopback3102. Reserved
`.example` domain must be replaced only after explicit domain approval. Authtoken
is omitted, not stored in Git. Local inspector/database/logging and remote agent
management are disabled in the sample. These fields follow the
[official v3 config reference](https://ngrok.com/docs/gateway/agent/config/v3).

ngrok was not found on PATH in this session; no install or ngrok command was run.
Existing js-yaml parsed the sample; ngrok CLI/schema/account validation is NOT RUN.
Future operator steps, only after separate approval:

1. Install/verify the official agent interactively; no Windows service/firewall edit.
2. Keep account token in a private local v3 config, outside versioned content and
   command transcripts. Review account access/retention before callback traffic.
3. Copy the sample into a private reviewed config; set the approved HTTPS domain
   and only upstream3102. Keep TLS verification on; no Basic Auth/browser challenge.
4. Validate the merged private config, then start only the named endpoint in a
   foreground terminal. Do not use `--all`, port3000 or port3001. ngrok supports
   configuration checks and named starts. [Official CLI](https://ngrok.com/docs/gateway/agent/cli).
5. From an external network verify allowed callbacks reach the verifier and other
   routes remain404/methods405; verify valid UTF-8/encoding behavior end-to-end.
6. Inspect local/cloud capture settings: cloud full capture is distinct from local
   inspection. Keeping full capture off alone is not proof that metadata redacts
   signed queries; verify that separately. This is a remaining audit requirement,
   not a claim that the sample controls cloud retention.
   [Traffic Inspector](https://ngrok.com/docs/obs/traffic-inspection).

No tunnel is launched by any repository script. Sample preparation is not public
reachability evidence or permission to start P01-D2.

## Merchant IPN and secret prerequisites

After explicit activation/setup approval, merchant owner must provide the approved
HTTPS IPN URL through VNPAY's merchant/support process and obtain confirmation for
the correct Sandbox TmnCode. Configure the matching Return URL separately; do not
infer IPN acceptance from successful domain allocation or browser Return. Verify
actual callback source/signature/amount/code pairs only with rotated credentials.

Secret rotation status: **NOT PERFORMED / NOT VERIFIED**. D1 neither reads a merchant
secret for use nor requests one in chat. Any secret previously disclosed in chat
must not be reused. Merchant owner must rotate/reissue through the provider and
confirm safe private storage, unresolved-Attempt drain/key continuity and gateway
configuration before use. Zero local gateway rows do not prove no external pending
transaction exists. No rotation or merchant registration operation was attempted.

External QueryDr response compatibility remains **PENDING**; default transport is
unchanged/disabled. Actual signed optional-field vectors/provider confirmation and
any separately approved transport enable remain prerequisites, not synthetic PASS.

## Verification and development-data audit

| Check | Result |
| --- | --- |
| New ingress unit/HTTP |67 PASS: raw target, plus/spaces/Unicode/duplicate/malformed forwarding, methods/routes, headers/body bounds, timeout/unavailable, ACK/status/303/redirect/logging |
| New real HTTP/Nest/PostgreSQL |13 PASS in isolated UUID schema: Return read-only all tables/sequences, IPN settle/replay, invalid callbacks, gate OFF, inaccessible APIs, amount0/1/4999/5000 |
| Full backend |812/812 PASS,26 suites;745 baseline retained |
| Full PostgreSQL |705/705 PASS,26 suites;692 baseline retained, including IPN/Return/QueryDr/zero/financial/Loyalty/Inventory |
| Frontend |228/228 PASS; source/UI unchanged |
| Both lint/typecheck/build |PASS; frontend built from isolated source copy |
| Prisma validate/status/diff |PASS;13 up to date, no difference |
| Compiled startup smoke |Owned ingress on3102; owned Nest bootstrap uses isolated DB/ephemeral port; netstat verifies exact127.0.0.1 listeners;6 production-ingress blocked paths PASS |
| Actual user's backend3001 |Observed127.0.0.1 listener; left running, no D1 callback tests forwarded into it |
| ngrok/Sandbox/actual merchant IPN |NOT RUN / NOT CONFIGURED |

Real forwarding tests use ephemeral loopback ports with exactly the same factory
and real Nest/PostgreSQL handlers.3001 was occupied, so no test stopped that process
or sent synthetic payment callbacks to development. Production launcher3102 was
separately tested only with rejected routes. Full fixed-port3001 public reachability
is not claimed. Test fixtures exist only in isolated test DB schemas and are removed.

READ ONLY preflight found **pre-existing changes since C2**: Orders18→19,
Payments10→11, Awards10→11, journal9→10, associated Cart/claim/item/stock/balance
fingerprints changed before D1 tests. This is not reported as nineteen fingerprints
equal to C2. Owner confirmation of the intervening demo remains pending.

Independent row-hash comparison against the verified C2 business snapshot shows
every historical Order/Payment/Award/journal/item/topping row remains byte-equivalent
in PostgreSQL JSON representation; no historical row is missing/changed. D1's fresh
READ ONLY pre/post snapshots match all19 table fingerprints, full13 migration
ledger/checksums, catalog/functions/sequences. No development writes/reset/restore
or historical baseline rewrite is performed. The pre-existing delta remains
explicit in evidence for owner review; it is not attributed to these isolated tests.

`frontend/next-env.d.ts` stays SHA256
`0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc` and is excluded.
Expected negative503 logs and existing pg deprecation notices are not test failures.
Machine evidence (evidence kiểm thử cũ đã dọn); local commit SHA is reported
in final response/Git history. No push. No actual Sandbox E2E PASS claim.

## Remaining blockers / P01-D2

Local infrastructure is complete. **Sandbox activation NOT READY** until minimum
amount policy, controlled local activation gate approval/implementation, rotated
merchant credentials, approved/registered callback domain/IPN/Return, external
reachability/TLS/logging checks, external QueryDr compatibility and representative
actual Sandbox tests are resolved. Intervening development demo confirmation remains
an audit follow-up; all task-time data preservation checks PASS.

P01-D2 may be separately assigned for a controlled ngrok setup after reviewing these
conditions. This task does not start it, open a public endpoint or authorize charges.
