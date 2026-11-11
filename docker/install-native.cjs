// The Windows lockfile omits Linux CSS binaries. Match the parent versions exactly.
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw Error('Docker build requires Linux x64/arm64');
const version = name => JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
execFileSync('npm', ['install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund',
  `lightningcss-linux-${process.arch}-gnu@${version('lightningcss')}`,
  `@tailwindcss/oxide-linux-${process.arch}-gnu@${version('@tailwindcss/oxide')}`], { stdio: 'inherit' });
