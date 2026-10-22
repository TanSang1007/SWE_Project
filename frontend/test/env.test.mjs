import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(relativePath) {
  const source = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function('module', 'exports', source)(compiled, compiled.exports);
  return compiled.exports;
}

test('Next supplies the local API at compilation for standalone development', () => {
  const original = { ...process.env };
  try {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.NODE_ENV = 'development';
    assert.equal(load('../next.config.ts').default.env.NEXT_PUBLIC_API_BASE_URL, 'http://127.0.0.1:3001');
    for (const mode of ['development', 'production']) {
      process.env.NODE_ENV = mode;
      process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.invalid';
      assert.equal(load('../next.config.ts').default.env.NEXT_PUBLIC_API_BASE_URL, 'https://api.example.invalid');
    }
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.NODE_ENV = 'production';
    assert.equal(load('../next.config.ts').default.env.NEXT_PUBLIC_API_BASE_URL, undefined);
    assert.throws(() => load('../src/lib/env.ts').getApiBaseUrl(), /required/);
  } finally {
    for (const key of ['NODE_ENV', 'NEXT_PUBLIC_API_BASE_URL']) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
  }
});
