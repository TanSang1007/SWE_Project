const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { Client } = require('pg');
const dotenv = require('dotenv');

function runtimeError(code) { return Object.assign(new Error(code), { code }); }
function loadConfiguration(root, mode, inherited = process.env) {
  if (!['MOCK', 'VNPAY_SANDBOX'].includes(mode)) throw runtimeError('INVALID_MODE');
  const base = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
  let privateValues = {};
  if (mode === 'VNPAY_SANDBOX') {
    const profile = inherited.BREWLITE_VNPAY_ENV_FILE || path.join(root, '.env.vnpay.local');
    if (fs.existsSync(profile)) privateValues = dotenv.parse(fs.readFileSync(profile));
  }
  const merged = { ...base, ...inherited, ...privateValues };
  // Explicit launcher selection wins over an old shell/session; no fallback.
  const env = { ...merged, NODE_ENV: 'development', PORT: '3001', FRONTEND_ORIGIN: 'http://localhost:3000',
    PAYMENT_PROVIDER_MODE: mode, VNPAY_SANDBOX_ENABLED: mode === 'VNPAY_SANDBOX' ? 'true' : 'false',
    VNPAY_ACCEPT_NEW_PAYMENTS: 'false', NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3001', NEXT_TELEMETRY_DISABLED: '1' };
  delete env.NODE_OPTIONS; delete env.BREWLITE_RECOVERY_PHASE; delete env.BREWLITE_RECOVERY_INSTANCE;
  delete env.VNPAY_INITIATION_TEST_ONLY; delete env.TEST_DATABASE_URL;
  const u = new URL(env.DATABASE_URL);
  const localDatabase = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  const neonDatabase = u.hostname.endsWith('.neon.tech') && u.hostname.includes('-pooler.')
    && u.pathname === '/brewlite_dev' && ['require', 'verify-full'].includes(u.searchParams.get('sslmode'));
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !(localDatabase || neonDatabase)) throw runtimeError('LOCAL_OR_NEON_DATABASE_REQUIRED');
  let callbackOrigin, ngrokConfig, callbackRole;
  if (mode === 'VNPAY_SANDBOX') {
    callbackRole = merged.BREWLITE_CALLBACK_ROLE || (localDatabase ? 'owner' : undefined);
    if (!['owner', 'member'].includes(callbackRole)) throw runtimeError('SET_BREWLITE_CALLBACK_ROLE_OWNER_OR_MEMBER');
    // Use the application's existing parser. No hostname or merchant is baked in.
    const { validateEnvironment } = require(path.join(root, 'backend/dist/config/environment.js'));
    const settings = validateEnvironment(env);
    callbackOrigin = new URL(settings.VNPAY_INITIATION_CONFIG.ipnUrl).origin;
    ngrokConfig = merged.BREWLITE_NGROK_CONFIG;
    if (callbackRole === 'owner' && (!ngrokConfig || !fs.existsSync(ngrokConfig))) throw runtimeError('SET_BREWLITE_NGROK_CONFIG');
  }
  return { mode, env, callbackOrigin, callbackRole, ngrokConfig, ngrokExecutable: merged.BREWLITE_NGROK_BIN || 'ngrok' };
}

async function assertPortsFree(ports) {
  for (const port of ports) await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(runtimeError('PORT_IN_USE_' + port)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
  });
}

async function dependencies(databaseUrl) {
  const u = new URL(databaseUrl);
  const db = new Client({ connectionString: u.toString(), connectionTimeoutMillis:5000 });
  try {
    await db.connect(); await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // PgBouncer rejects statement_timeout in startup options. Scope settings to
    // this read-only transaction instead; never leave session state in the pool.
    await db.query("SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','2000',true)");
    const counts = (await db.query(`SELECT
      (SELECT count(*)::int FROM payment_attempts WHERE state IN ('AWAITING','UNKNOWN') OR application_state IN ('PENDING','REVIEW')) unresolved,
      (SELECT count(*)::int FROM payment_verifications WHERE state='VERIFIED' AND processed_at IS NULL) unprocessed,
      (SELECT count(*)::int FROM orders WHERE status='PENDING' OR redemption_state='RESERVED') reservations,
      (SELECT count(*)::int FROM idempotency_requests WHERE state<>'COMPLETED') incomplete_claims`)).rows[0];
    await db.query('ROLLBACK');
    return { ...counts, needsCallbacks: counts.unresolved > 0 || counts.unprocessed > 0 || counts.incomplete_claims > 0,
      safeToStop: Object.values(counts).every(n => n === 0) };
  } finally { await db.end().catch(() => {}); }
}

async function health(origin) {
  const response = await fetch(origin + '/health', { signal: AbortSignal.timeout(3000) });
  if (response.status !== 200 || (await response.json()).status !== 'ok') throw runtimeError('BACKEND_HEALTH_FAILED');
}

async function callbackSmoke(origin) {
  const probes = [['/admin', 'GET',404], ['/payments/vnpay/ipn','POST',405],
    ['/payments/vnpay/ipn','GET',200], ['/payments/vnpay/return','GET',303]];
  for (const [route, method, status] of probes) {
    const r = await fetch(origin + route, { method, redirect:'manual', headers:{ Accept:'application/json' }, signal:AbortSignal.timeout(6000) });
    if (r.status !== status || r.headers.get('ngrok-error-code')) throw runtimeError('CALLBACK_HTTP_' + r.status);
    if (status === 303 && r.headers.get('location') !== 'http://localhost:3000/payments/vnpay/result') throw runtimeError('CALLBACK_RETURN_FAILED');
    if (status === 200 && (await r.json()).RspCode !== '99') throw runtimeError('CALLBACK_ACK_FAILED');
    await r.body?.cancel().catch(() => {});
  }
  return { healthy:true, checkedAt:new Date().toISOString(), probes:4, signedCallbacksSent:0 };
}

// No timer/Attempt-count admission rule. This decision depends on service health
// and an explicit operator drain, independent of elapsed time or payment totals.
function shouldAccept({ mode, servicesHealthy, draining }) {
  return mode === 'VNPAY_SANDBOX' && servicesHealthy && !draining;
}

module.exports = { loadConfiguration, assertPortsFree, dependencies, health, callbackSmoke, shouldAccept, runtimeError };
