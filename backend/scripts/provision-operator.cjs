// Manual create-only development/demo provisioning. Never imported by seed/startup.
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { createInterface } = require('node:readline/promises');
const { isEmail } = require('class-validator');
const { hash } = require('bcrypt');
const { Client } = require('pg');

class ProvisionError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function validateEnvironment(env) {
  if (env.NODE_ENV !== 'development' || env.ALLOW_OPERATOR_PROVISIONING !== 'true') throw new ProvisionError('ENVIRONMENT_NOT_ALLOWED');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new ProvisionError('DATABASE_NOT_ALLOWED'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_(dev|test)$/.test(url.pathname)) throw new ProvisionError('DATABASE_NOT_ALLOWED');
  // pg query parameters can override the URI host. Check the effective target too.
  let target;
  try { target = new Client({ connectionString: env.DATABASE_URL }); } catch { throw new ProvisionError('DATABASE_NOT_ALLOWED'); }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.host)
    || !/^[a-zA-Z0-9_]+_(dev|test)$/.test(target.database)) throw new ProvisionError('DATABASE_NOT_ALLOWED');
  const schema = url.searchParams.get('schema') ?? 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema)) throw new ProvisionError('DATABASE_NOT_ALLOWED');
  return schema;
}
function parseRole(args) {
  if (args.length !== 2 || args[0] !== '--role' || !['STAFF', 'ADMIN'].includes(args[1])) throw new ProvisionError('INVALID_ARGUMENTS');
  return args[1];
}
function validateInput({ email, password, role }) {
  if (typeof email !== 'string' || typeof password !== 'string' || !['STAFF', 'ADMIN'].includes(role)) throw new ProvisionError('INVALID_CREDENTIALS');
  email = email.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email) || Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new ProvisionError('INVALID_CREDENTIALS');
  }
  return email;
}
async function provisionOperator(client, input, env) {
  validateEnvironment(env);
  const email = validateInput(input);
  const passwordHash = await hash(input.password, 10);
  await client.query('BEGIN');
  try {
    const result = await client.query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,role',
      [randomUUID(), email, passwordHash, input.role]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new ProvisionError('EMAIL_ALREADY_EXISTS');
    throw new ProvisionError('PROVISION_FAILED');
  }
}
function readHidden(input, output, prompt) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return Promise.reject(new ProvisionError('INTERACTIVE_TERMINAL_REQUIRED'));
  return new Promise((accept, reject) => {
    let value = ''; const wasRaw = !!input.isRaw;
    function finish(error) {
      input.off('data', onData); input.off('end', onEnd); input.off('error', onError);
      input.setRawMode(wasRaw); input.pause(); output.write('\n');
      const result = value; value = '';
      if (error) reject(error); else accept(result);
    }
    function onEnd() { finish(new ProvisionError('PROVISION_ABORTED')); }
    function onError() { finish(new ProvisionError('PROVISION_ABORTED')); }
    function onData(chunk) {
      for (const char of chunk.toString()) {
        if (char === '\u0003' || char === '\u0004') { finish(new ProvisionError('PROVISION_ABORTED')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else if (char === '\t' || (char >= ' ' && char !== '\u001b')) value += char;
      }
    }
    input.setEncoding('utf8'); input.setRawMode(true); input.on('data', onData); input.once('end', onEnd); input.once('error', onError);
    output.write(prompt); input.resume();
  });
}
async function main() {
  require('dotenv').config({ path: resolve(__dirname, '../../.env'), quiet: true });
  const env = process.env; const schema = validateEnvironment(env); const role = parseRole(process.argv.slice(2));
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new ProvisionError('INTERACTIVE_TERMINAL_REQUIRED');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const credentials = { email: '', password: '', confirmation: '' }; let client;
  try {
    try { credentials.email = await readline.question('Email: '); } finally { readline.close(); }
    credentials.password = await readHidden(process.stdin, process.stdout, 'Password (hidden): ');
    credentials.confirmation = await readHidden(process.stdin, process.stdout, 'Confirm password (hidden): ');
    if (credentials.password !== credentials.confirmation) throw new ProvisionError('PASSWORD_MISMATCH');
    validateInput({ ...credentials, role });
    client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
    await client.query(`SET search_path TO "${schema}"`);
    const result = await provisionOperator(client, { ...credentials, role }, env);
    console.log(`Operator created: id=${result.id} role=${result.role}`);
  } finally {
    credentials.password = ''; credentials.confirmation = ''; credentials.email = '';
    if (client) await client.end();
  }
}
module.exports = { ProvisionError, validateEnvironment, validateInput, parseRole, provisionOperator, readHidden };
if (require.main === module) main().catch((error) => {
  const messages = { EMAIL_ALREADY_EXISTS: 'Email already exists; existing account unchanged.', ENVIRONMENT_NOT_ALLOWED: 'Provisioning requires development and explicit opt-in.',
    DATABASE_NOT_ALLOWED: 'Provisioning requires an allowed local development/test database.', INVALID_ARGUMENTS: 'Usage: --role STAFF or --role ADMIN. Credentials are entered interactively.',
    INTERACTIVE_TERMINAL_REQUIRED: 'Provisioning requires an interactive terminal.', INVALID_CREDENTIALS: 'Credentials must satisfy B07 email/password policy.',
    PASSWORD_MISMATCH: 'Password confirmation does not match.', PROVISION_ABORTED: 'Provisioning cancelled.' };
  console.error(error instanceof ProvisionError ? messages[error.code] ?? 'Provisioning failed; sensitive details suppressed.' : 'Provisioning failed; sensitive details suppressed.');
  process.exitCode = 1;
});
