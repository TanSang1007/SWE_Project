const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { RuntimeCoordinator } = require('../dev-runtime-manager.cjs');
const { shouldAccept, assertPortsFree, loadConfiguration, callbackSmoke } = require('../dev-runtime-lib.cjs');
const net = require('node:net'), http = require('node:http');

function fixture(mode = 'VNPAY_SANDBOX') {
  const state = { healthy:true, dependencies:{safeToStop:true,needsCallbacks:false}, backendRestarts:[], stopped:false, ingress:{pid:101}, ngrok:{pid:102}, calls:[] };
  const io = { dependencies:async()=>state.dependencies,
    startBackend:async a=>state.calls.push(['backend',a]), startCallbacks:async()=>state.calls.push(['callbacks']),
    startFrontend:async()=>state.calls.push(['frontend']), restartBackend:async a=>state.backendRestarts.push(a),
    verifyServices:async()=>{if(!state.healthy)throw Error('callback outage');}, stopAll:async()=>{state.stopped=true;} };
  return { runtime:new RuntimeCoordinator(mode,io),state };
}
test('normal admission remains open across days and consecutive independent payments; no Attempt/time limit', async()=>{
  const {runtime,state}=fixture();await runtime.start();
  for(const minutes of [31,60,1440,2880]) {
    assert(shouldAccept({mode:'VNPAY_SANDBOX',servicesHealthy:true,draining:false,minutes,attempts:minutes}));
    await runtime.check();assert(runtime.accepting);assert.equal(runtime.status,'READY');
  }
  assert.deepEqual(state.backendRestarts,[true]);assert(!state.stopped);
});
test('backend-only restart leaves callback ownership unchanged',async()=>{
  const {runtime,state}=fixture();await runtime.start();const before=[state.ingress,state.ngrok];await runtime.restart();
  assert.deepEqual([state.ingress,state.ngrok],before);assert.equal(state.calls.filter(c=>c[0]==='callbacks').length,1);
});
test('service loss drains admission; recovery reopens automatically independent of transactions',async()=>{
  const {runtime,state}=fixture();await runtime.start();state.healthy=false;await runtime.check();assert(!runtime.accepting);assert(!state.stopped);
  state.healthy=true;await runtime.check();assert(runtime.accepting);
});
test('operator drain stays closed during healthy monitoring and can explicitly recover',async()=>{
  const {runtime}=fixture();await runtime.start();await runtime.drain();await runtime.check();assert(!runtime.accepting);
  assert.equal(runtime.drainReason,'OPERATOR_DRAIN');assert(!runtime.stopRequested);
  await runtime.recover();assert(runtime.accepting);assert.equal(runtime.drainReason,null);
});
test('UNKNOWN and inventory reservations allow healthy startup and recovery but still prevent shutdown',async()=>{
  const {runtime,state}=fixture();
  state.dependencies={unresolved:1,reservations:1,unprocessed:0,incomplete_claims:0,safeToStop:false,needsCallbacks:true};
  const dependencies=structuredClone(state.dependencies), callbacks=[state.ingress,state.ngrok];
  await runtime.start();await runtime.check();assert(runtime.accepting);assert.equal(runtime.drainReason,null);
  assert.equal((await runtime.stop()).stopped,false);assert(runtime.stopRequested);
  await runtime.check();assert(!runtime.accepting);assert.equal(runtime.status,'DRAINING_CALLBACKS_RETAINED');
  await runtime.drain();assert(runtime.stopRequested);
  // recover is an explicit cancellation of stop intent, not a financial repair.
  await runtime.recover();assert(runtime.accepting);assert(!runtime.stopRequested);assert.equal(runtime.status,'READY');
  assert.deepEqual(state.dependencies,dependencies);assert.deepEqual([state.ingress,state.ngrok],callbacks);assert(!state.stopped);
  state.healthy=false;await runtime.check();assert(!runtime.accepting);
  state.healthy=true;await runtime.check();assert(runtime.accepting);
});
test('failed readiness recovery cannot cancel an active stop request',async()=>{
  const {runtime,state}=fixture();await runtime.start();state.dependencies={safeToStop:false,needsCallbacks:true};
  await runtime.stop();state.healthy=false;await assert.rejects(runtime.recover(),/callback outage/);
  assert(runtime.stopRequested);assert(!runtime.accepting);assert(!state.stopped);
  state.healthy=true;await runtime.check();assert(!runtime.accepting);assert(runtime.stopRequested);
});
test('failed dependency audit retains stop intent and callbacks through healthy monitoring',async()=>{
  const {runtime,state}=fixture();await runtime.start();runtime.io.dependencies=async()=>{throw Error('database unavailable');};
  await assert.rejects(runtime.stop(),/database unavailable/);await runtime.check();
  assert(runtime.stopRequested);assert(!runtime.accepting);assert(!state.stopped);
});
for(const kind of ['PENDING','UNKNOWN','REVIEW','receipt','reservation'])test('stop retains callbacks for '+kind,async()=>{
  const {runtime,state}=fixture();await runtime.start();state.dependencies={safeToStop:false,needsCallbacks:true,kind};
  const result=await runtime.stop();assert(!result.stopped);assert(!state.stopped);assert(!runtime.accepting);assert.equal(runtime.status,'DRAINING_CALLBACKS_RETAINED');
  state.dependencies={safeToStop:true,needsCallbacks:false};assert((await runtime.stop()).stopped);assert(state.stopped);
});
test('MOCK does not start callback processes or enable VNPAY admission',async()=>{
  const {runtime,state}=fixture('MOCK');await runtime.start();assert(!runtime.accepting);assert(!state.calls.some(c=>c[0]==='callbacks'));assert((await runtime.stop()).stopped);
});
test('MOCK refuses to strand outstanding gateway callbacks',async()=>{
  const {runtime,state}=fixture('MOCK');state.dependencies={safeToStop:false,needsCallbacks:true};await assert.rejects(runtime.start(),/OUTSTANDING_GATEWAY/);assert.equal(state.calls.length,0);
});
test('configuration selection defaults to MOCK without opening private merchant profile; clears inherited session gates',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'brewlite-config-'));
  try{fs.writeFileSync(path.join(folder,'.env'),'DATABASE_URL=postgresql://user:synthetic@localhost/brewlite_test\n');
    const config=loadConfiguration(folder,'MOCK',{PAYMENT_PROVIDER_MODE:'VNPAY_SANDBOX',NODE_OPTIONS:'--require=old-session',BREWLITE_VNPAY_ENV_FILE:'missing-private-file'});
    assert.equal(config.env.PAYMENT_PROVIDER_MODE,'MOCK');assert.equal(config.env.VNPAY_ACCEPT_NEW_PAYMENTS,'false');assert.equal(config.ngrokConfig,undefined);assert.equal(config.env.NODE_OPTIONS,undefined);
    assert.equal(config.env.NEXT_PUBLIC_API_BASE_URL,'http://127.0.0.1:3001');
  }finally{fs.unlinkSync(path.join(folder,'.env'));fs.rmdirSync(folder);}
});
test('port collision refuses startup without terminating the existing listener',async()=>{
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const port=server.address().port;await assert.rejects(assertPortsFree([port]),{code:'PORT_IN_USE_'+port});assert(server.listening);}finally{await new Promise(r=>server.close(r));}
});
test('shared Neon database requires TLS and an explicit VNPAY callback role',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'brewlite-neon-config-'));
  try {
    const write=url=>fs.writeFileSync(path.join(folder,'.env'),'DATABASE_URL='+url+'\n');
    write('postgresql://user:synthetic@endpoint-pooler.region.aws.neon.tech/brewlite_dev?sslmode=require');
    assert.equal(loadConfiguration(folder,'MOCK',{}).mode,'MOCK');
    assert.throws(()=>loadConfiguration(folder,'VNPAY_SANDBOX',{}),{code:'SET_BREWLITE_CALLBACK_ROLE_OWNER_OR_MEMBER'});
    write('postgresql://user:synthetic@endpoint-pooler.region.aws.neon.tech/brewlite_dev');
    assert.throws(()=>loadConfiguration(folder,'MOCK',{}),{code:'LOCAL_OR_NEON_DATABASE_REQUIRED'});
    write('postgresql://user:synthetic@unapproved.example/brewlite_dev?sslmode=require');
    assert.throws(()=>loadConfiguration(folder,'MOCK',{}),{code:'LOCAL_OR_NEON_DATABASE_REQUIRED'});
  } finally { fs.unlinkSync(path.join(folder,'.env'));fs.rmdirSync(folder); }
});
test('Neon member uses the registered shared callback without requiring a tunnel; owner requires private ngrok config',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'brewlite-shared-callback-'));
  try {
    fs.writeFileSync(path.join(folder,'.env'),[
      'DATABASE_URL=postgresql://fixture:synthetic@endpoint-pooler.region.aws.neon.tech/brewlite_dev?sslmode=require',
      'JWT_SECRET=synthetic-shared-callback-jwt-secret-at-least-32-bytes',
      'VNPAY_ENV=SANDBOX','VNPAY_VERSION=2.1.0','VNPAY_TMN_CODE=TEST0001',
      'VNPAY_HASH_SECRET=synthetic-shared-callback-unit-test',
      'VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      'VNPAY_RETURN_URL=https://callback.example.org/payments/vnpay/return',
      'VNPAY_IPN_URL=https://callback.example.org/payments/vnpay/ipn',
    ].join('\n'));
    const root=path.resolve(__dirname,'../..');
    // Configuration parser is the built backend used by the actual launcher.
    fs.mkdirSync(path.join(folder,'backend'),{recursive:true});
    fs.symlinkSync(path.join(root,'backend/dist'),path.join(folder,'backend/dist'),'junction');
    const member=loadConfiguration(folder,'VNPAY_SANDBOX',{BREWLITE_CALLBACK_ROLE:'member'});
    assert.equal(member.callbackRole,'member');assert.equal(member.ngrokConfig,undefined);
    assert.equal(member.env.VNPAY_ACCEPT_NEW_PAYMENTS,'false');
    assert.equal(member.callbackOrigin,'https://callback.example.org');
    assert.throws(()=>loadConfiguration(folder,'VNPAY_SANDBOX',{BREWLITE_CALLBACK_ROLE:'owner'}),{code:'SET_BREWLITE_NGROK_CONFIG'});
    const owner=loadConfiguration(folder,'VNPAY_SANDBOX',{BREWLITE_CALLBACK_ROLE:'owner',BREWLITE_NGROK_CONFIG:path.join(folder,'.env')});
    assert.equal(owner.callbackRole,'owner');
    assert.equal(owner.callbackOrigin,member.callbackOrigin);
    assert.throws(()=>loadConfiguration(folder,'VNPAY_SANDBOX',{BREWLITE_CALLBACK_ROLE:'invalid'}),{code:'SET_BREWLITE_CALLBACK_ROLE_OWNER_OR_MEMBER'});
  } finally {
    fs.rmdirSync(path.join(folder,'backend/dist'));fs.rmdirSync(path.join(folder,'backend'));
    fs.unlinkSync(path.join(folder,'.env'));fs.rmdirSync(folder);
  }
});
test('callback smoke uses no signed-success input and detects route/Return failures',async()=>{
  let invalid=false;const seen=[];
  const server=http.createServer((req,res)=>{seen.push(req.url);if(req.url==='/admin')res.writeHead(404).end();
    else if(req.method==='POST')res.writeHead(405).end();else if(req.url.endsWith('/return'))res.writeHead(303,{Location:invalid?'https://foreign.invalid':'http://localhost:3000/payments/vnpay/result'}).end();
    else res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({RspCode:'99'}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const origin='http://127.0.0.1:'+server.address().port;assert((await callbackSmoke(origin)).healthy);assert(seen.every(p=>!p.includes('?')));invalid=true;await assert.rejects(callbackSmoke(origin),{code:'CALLBACK_RETURN_FAILED'});}
  finally{await new Promise(r=>server.close(r));}
});
