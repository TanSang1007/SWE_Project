// Development setup only. Preserve existing secrets; never print their values.
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { parse } = require('dotenv');
const file = resolve(__dirname, '../../.env');
try {
  let content = readFileSync(file, 'utf8'); const values = parse(content);
  if (!values.JWT_SECRET || values.JWT_SECRET.startsWith('replace_with_')) {
    const line = `JWT_SECRET=${randomBytes(32).toString('hex')}`;
    content = /^JWT_SECRET=.*$/m.test(content) ? content.replace(/^JWT_SECRET=.*$/m, line) : `${content.trimEnd()}\n${line}\n`;
  }
  if (!values.JWT_EXPIRES_IN) content = `${content.trimEnd()}\nJWT_EXPIRES_IN=3600\n`;
  writeFileSync(file, content); console.log('Local JWT env configured; existing values preserved; secret suppressed');
} catch { console.error('Copy .env.example to .env before local auth setup; details suppressed'); process.exitCode = 1; }
