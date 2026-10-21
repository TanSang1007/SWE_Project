import { createCallbackIngress, INGRESS_HOST, INGRESS_PORT } from './server';

const server = createCallbackIngress();
server.once('error', () => { console.error('Callback ingress could not start.'); process.exitCode = 1; });
server.listen(INGRESS_PORT, INGRESS_HOST, () => {
  console.info('Callback ingress listening on 127.0.0.1:3102 (IPN/Return only).');
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  server.close(); server.closeAllConnections();
});
