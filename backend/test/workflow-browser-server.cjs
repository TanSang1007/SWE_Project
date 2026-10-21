// Compiled real AppModule, with only its DB adapter scoped to an owned test schema.
const { AppModule } = require('../dist/app.module');
const { configureApp } = require('../dist/common/configure-app');
const { createBrowserApp } = require('./browser-app.cjs');
(async()=>{
  if (!process.env.BROWSER_TEST_SCHEMA) throw new Error('Isolated schema required');
  const app = await createBrowserApp(AppModule); configureApp(app); await app.listen(Number(process.env.PORT??3001),'127.0.0.1');
})().catch(()=>{console.error('Workflow verification server failed; sensitive details suppressed');process.exitCode=1;});
