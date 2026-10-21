// Verification-only guard endpoint. Never imported into production AppModule.
require('reflect-metadata');
const { Module, Controller, Get, Req, UseGuards } = require('@nestjs/common');
const { createBrowserApp } = require('./browser-app.cjs');
const { AppModule } = require('../dist/app.module');
const { configureApp } = require('../dist/common/configure-app');
const { JwtAuthGuard } = require('../dist/auth/guards/jwt-auth.guard');
const { RolesGuard } = require('../dist/auth/guards/roles.guard');
const { Roles } = require('../dist/auth/roles.decorator');
class Probe {
  get(req) { return { authenticated: true, user: req.user }; }
  operator(req) { return { allowed: true, role: req.user.role }; }
  admin(req) { return { allowed: true, role: req.user.role }; }
}
const descriptor = Object.getOwnPropertyDescriptor(Probe.prototype, 'get');
Controller('__auth_verify')(Probe);
Get()(Probe.prototype, 'get', descriptor);
UseGuards(JwtAuthGuard)(Probe.prototype, 'get', descriptor);
Req()(Probe.prototype, 'get', 0);
for (const [name, roles] of [['operator', ['STAFF', 'ADMIN']], ['admin', ['ADMIN']]]) {
  const method = Object.getOwnPropertyDescriptor(Probe.prototype, name);
  Get(name)(Probe.prototype, name, method); UseGuards(JwtAuthGuard, RolesGuard)(Probe.prototype, name, method);
  Roles(...roles)(Probe.prototype, name, method); Req()(Probe.prototype, name, 0);
}
class VerificationModule {}
Module({ imports: [AppModule], controllers: [Probe] })(VerificationModule);
(async () => {
  const app = await createBrowserApp(VerificationModule);
  configureApp(app); await app.listen(Number(process.env.AUTH_VERIFY_PORT ?? 3001), '127.0.0.1');
})().catch((error) => { console.error(`Auth verification server failed (${error instanceof Error ? error.name : 'unknown'}); sensitive details suppressed`); process.exitCode = 1; });
