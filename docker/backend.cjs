// Keep the existing callback allowlist and loopback upstream in the same container.
const { fork } = require('node:child_process');
const { createCallbackIngress } = require('../backend/dist/callback-ingress/server');
const ingress = createCallbackIngress();
const backend = fork('/app/backend/dist/main.js', [], { stdio: 'inherit' });
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  ingress.close(); ingress.closeAllConnections();
  backend.kill('SIGTERM');
  const timer = setTimeout(() => process.exit(code), 12000);
  timer.unref();
  backend.once('exit', () => process.exit(code));
}
ingress.once('error', () => stop(1));
ingress.listen(3102, '0.0.0.0');
backend.once('error', () => stop(1));
backend.once('exit', code => { if (!stopping) { ingress.close(); process.exit(code || 1); } });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(0));
