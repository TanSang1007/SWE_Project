const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { createHash } = require('node:crypto');
const files = ['README.md', 'Docs/REQUIREMENTS.md', 'Docs/DECISIONS.md', 'Docs/ARCHITECTURE.md', 'Docs/API_DESIGN.md', 'Docs/DATABASE_DESIGN.md', 'Docs/TRACEABILITY_MATRIX.md', 'Docs/DEVELOPMENT_PLAN.md', 'Docs/B08_CART_CONTRACT.md'];
let links = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]; if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split('#'); const absolute = path ? resolve(dirname(file), path) : resolve(file);
    assert(existsSync(absolute), `Missing local link in ${file}: ${path}`);
    if (anchor) {
      const headings = [...readFileSync(absolute, 'utf8').matchAll(/^#+ (.+)$/gm)].map((m) => m[1].trim().toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replaceAll(' ', '-'));
      assert(headings.includes(anchor), `Missing heading anchor in ${file}: ${target}`);
    }
    links++;
  }
}
assert.equal(createHash('sha256').update(readFileSync('Docs/BrewLite-CongNghePhanMem.pdf')).digest('hex').toUpperCase(), '08EFC9A6CC247123500419F01160C76712EC773AFFC998D2193F2873EF5312CC');
assert(readFileSync('Docs/DEVELOPMENT_PLAN.md', 'utf8').includes('- [x] **B08'));
const report = JSON.parse(readFileSync('Docs/B08_CART_BROWSER_EVIDENCE.json', 'utf8'));
assert(report.checks.some((c) => c.includes('B08 real FE/BE/PostgreSQL')));
assert(!/accessToken|passwordHash|Authorization|Bearer /.test(JSON.stringify(report)));
console.log(`PASS: ${links} local documentation links/anchors; original PDF hash; B08 checklist/evidence without credentials`);
