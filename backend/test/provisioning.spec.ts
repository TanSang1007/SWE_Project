import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { ReadStream, WriteStream } from 'node:tty';
import { resolve } from 'node:path';
import { parseRole, readHidden, validateEnvironment, validateInput } from '../scripts/provision-operator.cjs';

const env = { NODE_ENV: 'development', ALLOW_OPERATOR_PROVISIONING: 'true', DATABASE_URL: 'postgresql://fixture:example@localhost:5432/brewlite_test' };
test('CLI environment fails closed outside explicitly allowed local development', () => {
  expect(validateEnvironment(env)).toBe('public');
  for (const bad of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { ALLOW_OPERATOR_PROVISIONING: 'false' },
    { DATABASE_URL: 'postgresql://fixture:example@remote.invalid:5432/brewlite_dev' }, { DATABASE_URL: 'postgresql://localhost/brewlite' },
    { DATABASE_URL: 'postgresql://localhost/brewlite_dev?host=remote.invalid' }, { DATABASE_URL: 'postgresql://localhost/brewlite_dev?host=/tmp' }, { DATABASE_URL: 'invalid' }]) {
    expect(() => validateEnvironment({ ...env, ...bad })).toThrow();
  }
});
test('CLI accepts only explicit ADMIN/STAFF; no password arguments or CUSTOMER role', () => {
  expect(parseRole(['--role', 'ADMIN'])).toBe('ADMIN'); expect(parseRole(['--role', 'STAFF'])).toBe('STAFF');
  for (const args of [[], ['--role', 'CUSTOMER'], ['--role', 'ADMIN', '--password', randomBytes(8).toString('hex')]]) expect(() => parseRole(args)).toThrow('INVALID_ARGUMENTS');
});
test('CLI uses B07 normalized email and UTF-8 password bytes without trimming', () => {
  expect(validateInput({ email: ' Example@EXAMPLE.INVALID ', role: 'ADMIN', password: 'é'.repeat(36) })).toBe('example@example.invalid');
  for (const password of ['short', 'é'.repeat(37)]) expect(() => validateInput({ email: 'a@example.invalid', role: 'STAFF', password })).toThrow('INVALID_CREDENTIALS');
});
class Terminal extends PassThrough {
  isTTY = true; isRaw = false;
  setRawMode(value: boolean) { this.isRaw = value; return this; }
}
test('hidden password prompt emits no secret/characters and restores terminal mode', async () => {
  const input = new Terminal(); const output = new Terminal(); let printed = '';
  output.on('data', (chunk: Buffer) => { printed += chunk.toString(); });
  const password = ` ${randomBytes(16).toString('hex')}\t `;
  const pending = readHidden(input as unknown as ReadStream, output as unknown as WriteStream, 'Password: ');
  input.emit('data', Buffer.from(`${password}\r`)); expect(await pending).toBe(password);
  expect(printed).toBe('Password: \n'); expect(printed).not.toContain(password); expect(input.isRaw).toBe(false); expect(input.listenerCount('data')).toBe(0);
});
test('hidden prompt aborts without logging buffer and restores raw state', async () => {
  const input = new Terminal(); const output = new Terminal(); let printed = '';
  output.on('data', (chunk: Buffer) => { printed += chunk.toString(); });
  const pending = readHidden(input as unknown as ReadStream, output as unknown as WriteStream, 'Password: ');
  input.emit('data', Buffer.from('private-buffer\u0003')); await expect(pending).rejects.toThrow('PROVISION_ABORTED');
  expect(printed).toBe('Password: \n'); expect(input.isRaw).toBe(false);
});
test('actual executable rejects production and password arguments without leaking secrets', () => {
  const secret = randomBytes(24).toString('hex');
  for (const [settings, args] of [[{ ...env, NODE_ENV: 'production' }, ['--role', 'ADMIN']], [env, ['--role', 'ADMIN', '--password', secret]]] as const) {
    const result = spawnSync(process.execPath, [resolve(__dirname, '../scripts/provision-operator.cjs'), ...args],
      { env: { ...process.env, ...settings, DATABASE_URL: `postgresql://fixture:${secret}@localhost:5432/brewlite_test` }, encoding: 'utf8' });
    expect(result.status).toBe(1); expect(result.stdout + result.stderr).not.toContain(secret); expect(result.stdout + result.stderr).not.toMatch(/postgresql:|password_hash|\$2[aby]\$/);
  }
});
