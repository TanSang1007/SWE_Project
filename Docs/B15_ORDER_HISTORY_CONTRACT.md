# B15 — Order confirmation and history

**ORDER HISTORY READY (technical user scope), 2026-10-09–10 (Asia/Saigon).** Full checks and real Edge acceptance PASS; human manual QA/full team DoD are not claimed.

Scope: existing baseline FR09/FR10, Task9, BR03/06/09/11/12/14 and NFR02/03/04/05/06/10. GET /orders/me is already designed in API_DESIGN section5; /orders and /orders/[id]/confirmation are UI08/UI07 in REQUIREMENTS. No new business rule, endpoint outside baseline, schema, pagination, staff workflow or B16 transition is added.

Pre-flight started at5cb3f5895ed919a988b5c615bcd7c8158dd8c1d1 with6 known diffs. User approved separate B13 follow-up; backend lint, Promotion28/28 (including seed idempotency and promotion-only isolation) and diff --check PASS. Exactly5 B13 files committed at a8a6538e643b353dbe7ade664e42c2c9574a37c3, message fix: add promotion-only development seed. Only generated frontend/next-env.d.ts remains; its original bytes are preserved/excluded from B15 commit. Read-only PostgreSQL verification confirms one active BREW10K10000 in brewlite_dev/public; no development seed/reset/delete performed in this follow-up.

## Contract before implementation

| Endpoint | Input / authority | Success / errors |
| --- | --- | --- |
| GET /orders/me | JWT customer; no query/body options or client userId | 200 {items:[summary]}; empty items valid;401 unauthorized;400 invalid input;503 sanitized read faults; existing guard faults500 |
| GET /orders/:id | Existing JWT owner/UUID lookup; no query/body options | Existing immutable snapshot + paidAt/earnedPoints/paymentStatus; missing or cross-owner404 ORDER_NOT_FOUND;400 UUID/input;401 auth;503 safe read faults |

Summary has exactly id, orderCode, status, total integer VND string, currency VND, createdAt ISO8601, earnedPoints number/null. Sort createdAt DESC then id DESC; no limit/cursor/offset/pagination. Detail remains existing B10/B11 response: snapshot item names/options/qty/unit/line totals/subtotal/fixed discount/code/final total, with paidAt/current effective earnedPoints/latest paymentStatus. The summary does not add paidAt/paymentStatus fields; these are available in detail.

Both reads are private/no-store and read-only. No Cart/stock/Order/Payment/award/balance/claim/timestamp writes. earnedPoints uses stored active award: null for unawarded unpaid Orders, points including0 for active award,0 for CANCELLED/reversed award; no current price or formula recalculation. Existing PAID/preparation/COMPLETED projections can be read; creating internal preparation/reversal commands remains B16.

## Existing audit / bounded work

Already implemented and reused: POST /orders snapshot/idempotency/active-unpaid guard, GET /orders/:id owner/read/error projection, POST /orders/:id/cancel unpaid semantics, B10-B12 inline confirmation/OrderSummary and safe cached transport recovery, B11 atomic Payment/award/balance, B13 promotion snapshot, B14 current balance.

Missing before B15 and now implemented: GET /orders/me, persistent-address confirmation/history pages, history navigation, frontend parsing of detail metadata, and dedicated history/read-only acceptance tests. OrderService shares its existing effective-point projection between history/detail. History selects only summary fields/stored award; existing create/cancel/Payment/Pricing rules and schema are unchanged.

UI: /orders list and /orders/[id]/confirmation detail, Vietnamese status names for all7 existing states, created time/VND/current effective points, loading/empty/error/Retry, native links/buttons/focus/responsive390/768/1366 and memory-session isolation. Fresh GET on entry/Retry; refresh requires login again under existing auth policy. Checkout remains inline and gains an explicit read-only confirmation link. Unpaid detail links back to /cart with the known Order ID; existing pending transport context takes precedence, recovery must GET current owner Order before displaying actions. No POST just to display confirmation and no automatic payment/retry/cancel from history/details.

OrderSummary was extracted unchanged into a pure shared display component, retaining the existing checkout export/default raw-status display and providing optional Vietnamese labels for detail. History does not import checkout/Cart/Payment behavior. Detail parser reuses existing snapshot parser and adds only designed metadata; summary parser whitelists7 fields and rejects duplicate IDs/malformed money/status/time/points. No frontend total/point recalculation. AbortController, token checks and session/Order-ID keys discard old responses after logout/account switch/route changes. Current401 clears auth/data; late401/200 from a previous account cannot affect a new session.

Known-ID resume uses /cart?orderId=UUID (frontend route metadata only), validates syntax then existing JWT-owner GET. Original cached Payment context wins over saved known create ID; unknown create transport result retains its original key/payload and cannot be replaced by a history link. New Cart session starts restoration before any action is available. Only explicit existing checkout payment/cancel actions send POST; no new backend resume/discovery endpoint or history mutation controls.

## Tests and full regression

| Check at repository root | Observed result |
| --- | --- |
| npm.cmd run lint --workspace backend | B13 checkpoint PASS |
| npm.cmd run test:database --workspace backend -- --runTestsByPath test/database/promotions.spec.ts | B13 checkpoint28/28 PASS, including promotion-only CLI/full-seed idempotency/other-table isolation/stock preservation |
| npm.cmd run test --workspace backend | 6 suites96/96 PASS:72 existing B04–B14 +24 B15 HTTP/projection/security/error/cache tests |
| npm.cmd run test --workspace frontend | 93/93 PASS:81 existing +12 B15 parser/API/render/session/recovery tests; rerun after Cart key change PASS |
| npm.cmd run test:database --workspace backend -- --json --outputFile=../.b15-database-results.tmp | 10 suites214/214 PASS:204 existing +10 B15; D33 worker recycling preserved |
| npm.cmd run lint | Both workspaces PASS, max-warnings0; final run after harness/Cart changes PASS |
| npm.cmd run build --workspace backend / frontend | Both PASS; /orders, /orders/[id]/confirmation and dynamic /cart compiled |
| npm.cmd run db:format / db:validate / db:generate / db:status | PASS; no schema diff,2 migrations up to date |
| npm.cmd run test:history:browser --workspace frontend | Owned compiled Next3000/Nest3001/PostgreSQL + Edge154.0.4258.62 PASS; B06–B14 regression and B15 A–F |

Backend HTTP coverage: empty/me route precedence, exact field projection/JWT scope/native sort/no-store/Vary, all7 current states/effective null/0/reversed points, maximum Decimal money string, fresh reads, missing/invalid/expired/unknown-user JWT401, owner/body/status/limit/offset/cursor injection400, common cross-owner404 and sanitized503 read failures. Mocks assert no Order writes. Existing guard database-error handling remains sanitized500 as baseline.

New PostgreSQL suite uses local _dev/_test and a UUID schema with existing migrations; only that schema is dropped in teardown. Cases: empty user causes no Cart/Order/claim; one/multiple summaries; real create/PAID/failure/cancel with points/Payment detail; exact timestamp ties sort UUID DESC; re-login/second-user isolation; Product/size/topping/name/association/Promotion drift does not change snapshot; repeated GETs preserve every fixture table/timestamp; existing PREPARING/READY/COMPLETED projection fixtures follow allowed edges without implementing B16 commands; zero-total award0; invalid auth/query/body rejection. Historical B16 internal reversal is not marked implemented or tested as a workflow.

Frontend coverage: whitelist/nullable points/server order, malformed/duplicate IDs/money/status/time, snapshot metadata, only private GET/no body/key/price/owner input, guest/expired auth and invalid ID, late-response account isolation,404/error/Retry/new reads, all7 Vietnamese labels/time/VND/navigation, loading/empty/error roles, exact maximum VND, snapshot/detail actions and cancelled no-refund semantics, cached transport precedence during resume. Old Cart/Checkout/Payment/Loyalty tests remain enabled.

Sanitized full regression report (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)). No dependency/lockfile/schema/migration/award-engine change. Known pg concurrent-query deprecation/intentional sanitized fault logs remain non-failing; no native termination occurred in this completed PostgreSQL run. D33 upstream root cause remains unproven.

## Browser A–F and read-only evidence

Final run uses owned compiled Next3000/Nest3001, real development PostgreSQL and Edge154.0.4258.62. Earlier B06 menu/detail/states, B07 auth, B08 Cart, B10 creation/cancel/stock, B11 payment/replay/award, B12 transport recovery/keyboard and B13 Promotion/B14 balance scenarios rerun with separate B15 artifacts. Six successful Payments/six awards/balance46 remain after the regression flows; added B15 failed/cancelled/pending-read scenarios do not award.

- A: a real PAID Order appears in /orders, opens current confirmation and renders designed metadata.
- B: real promoted Order62000-10000=52000, mock FAILURE produces PAYMENT_FAILED; history/detail show the result. Current Product name/price and Promotion config change, while historical snapshot/code/total remain original.
- C: known-ID unpaid detail resumes checkout through GET with zero create/payment POST; explicit existing cancel produces CANCELLED, history/detail then show0 contribution and no refund claim.
- D: multiple legitimate Orders have exact SQL createdAt DESC/id DESC order; a further PENDING Order is visible from checkout confirmation link/history before explicit unpaid cancel.
- E: confirmation refresh loses memory JWT, login returns to the same Order ID and reads backend; no new Order/Payment. Delayed read/loading/no stale list, network error and native keyboard Tab/Enter Retry recover.
- F: a second real user has empty history; first owner's UUID yields actual404 and friendly missing detail. Controlled401 clears auth/list; original user can re-login to persistent history.

For each read-only sequence, hashes/counts of all public base tables match before/after, including timestamps; tracked checkout create/payment/cancel POST counts are unchanged. Auth login is allowed and read-only. History/detail/resume GETs do not modify Order/Cart/Stock/Payment/Loyalty/claims. Fixtures/accounts/history/Promotions were cleaned; original catalog price/name/stock/version/timestamps and pre-existing Promotions are preserved. No user's development history was deleted.

History and confirmation layouts at390x844,768x1024,1366x768 have no horizontal overflow and45px Retry action height; visible keyboard focus/Enter verified. Browser/network/layout report (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), history390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), confirmation390 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 768 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)), 1366 (evidence lịch sử đã dọn; xem [hướng dẫn hiện hành](NORMAL_SANDBOX_MODE.md)). B14 regression balance images use B15-only filenames; historical B06–B14 artifacts are untouched.

## Tooling, Git and remaining issues

Preliminary checks caught fixture typing/lint and frontend test coupling to Cart subscription; corrected before final PASS. OrderSummary extraction keeps display behavior and prevents that dependency. Early browser attempts hit occupied frontend3000; cleanup originally awaited an unconnected database, so a connection guard was added. Reused Next dev later stopped responding during reload; it was never stopped by this harness. Final runs own the compiled frontend. B15 loading/error interception originally failed CORS OPTIONS; fixture now forwards preflights to the real backend and intercepts only intended business requests. All acceptance assertions remain enabled; final browser run exit0.

Related B14 contract punctuation/Vietnamese characters were restored and its B15 earnedPoints/history boundary linked; no contract/business change. Generated frontend/next-env.d.ts is restored to pre-flight bytes and excluded from B15 staging. Temporary results/snapshot files are ignored and removed after verification. Commit scope is B15 source/tests/evidence/docs only, separate from the approved5-file B13 checkpoint. No global Git config, remote or push.

Human manual QA/screen-reader user testing, Firefox/full browser matrix, NFR01 latency, team review/full DoD, B16 internal preparation/paid cancellation/reversal and deployment remain pending. Next recommended task: B16 when explicitly assigned. No B16 or full UI redesign is implemented here.
