// Portable local launcher. No gateway initiation, callback signing or settlement.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { fork, spawn } = require('node:child_process');
const { RuntimeCoordinator } = require('./dev-runtime-manager.cjs');
const { loadConfiguration, assertPortsFree, dependencies, health, callbackSmoke, runtimeError } = require('./dev-runtime-lib.cjs');
const root = path.resolve(__dirname, '..'), runtimeDir = path.join(root, '.brewlite');
const stateFile = path.join(runtimeDir, 'runtime.json'), lockFile = path.join(runtimeDir, 'launcher.lock');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = child => !!child && child.exitCode === null && child.signalCode === null;

async function control(action) {
  if (!fs.existsSync(stateFile)) throw runtimeError('NO_MANAGED_RUNTIME');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const response = await fetch(`http://127.0.0.1:${state.controlPort}/${action}`, {
    method:action === 'status' ? 'GET' : 'POST', headers:{ Authorization:'Bearer ' + state.controlToken },
    signal:AbortSignal.timeout(90000) });
  const result = await response.json(); console.log(JSON.stringify(result, null, 2));
  if (!response.ok || result.stopped === false) process.exitCode = 2;
}

function sourceCopy() {
  const source = path.join(root, 'frontend'), files = [];
  function walk(folder) { for (const e of fs.readdirSync(folder, { withFileTypes:true })) {
    const p = path.join(folder, e.name); if (e.isDirectory()) walk(p); else files.push(p);
  } }
  for (const name of ['src','public']) walk(path.join(source, name));
  for (const name of ['package.json','tsconfig.json','next.config.ts','postcss.config.mjs','next-env.d.ts']) files.push(path.join(source,name));
  const hash = crypto.createHash('sha256');
  for (const p of files.sort()) { hash.update(path.relative(source,p)); hash.update(fs.readFileSync(p)); }
  const destination = path.join(runtimeDir, 'builds', hash.digest('hex').slice(0,20));
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive:true });
    for (const p of files) { const out = path.join(destination,path.relative(source,p)); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.copyFileSync(p,out); }
  }
  return destination;
}

async function build(executable, args, cwd, env, label) {
  console.log('Building ' + label + '...');
  const child = spawn(process.execPath, [require.resolve(executable), ...args], { cwd, env, windowsHide:true, stdio:['ignore','pipe','pipe'] });
  // Compiler output is captured locally; never attach private runtime config logs.
  let output = ''; const append = b => { output = (output + b.toString()).slice(-32000); };
  child.stdout.on('data',append); child.stderr.on('data',append);
  const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('close',resolve); });
  if (code !== 0) { fs.writeFileSync(path.join(runtimeDir,'build-error.log'),output,{mode:0o600}); throw runtimeError('BUILD_FAILED_' + label); }
}

async function start(mode) {
  fs.mkdirSync(runtimeDir, { recursive:true, mode:0o700 });
  if (fs.existsSync(lockFile)) {
    const pid = Number(fs.readFileSync(lockFile,'utf8')); let live = true;
    try { process.kill(pid,0); } catch (e) { if (e.code === 'ESRCH') live = false; }
    if (live) throw runtimeError('LAUNCHER_ALREADY_RUNNING_USE_DEV_STATUS');
    fs.unlinkSync(lockFile); // A dead launcher's marker only; never kill unknown PIDs.
  }
  fs.writeFileSync(lockFile,String(process.pid),{flag:'wx',mode:0o600});
  const owned = {}, token = crypto.randomBytes(32).toString('hex'); let coordinator, config, controlServer, monitor, closing = false, stopRequested = false, startupComplete = false;
  let chain = Promise.resolve(), backendSnapshot = null, callback = null, frontendBuild;
  const serialize = work => { const result = chain.then(work); chain = result.catch(() => {}); return result; };
  const report = () => ({ mode, status:coordinator?.status || 'BUILDING', launcherPid:process.pid,
    acceptingNewPayments:coordinator?.accepting ?? false, backend:backendSnapshot,
    processes:Object.fromEntries(Object.entries(owned).map(([kind,c]) => [kind,{pid:c.pid,alive:alive(c)}])),
    frontend:'http://localhost:3000', callback, automaticSessionExpiry:false, attemptLimit:null,
    draining:coordinator?.draining ?? false });
  function own(kind, executable, args, env, ipc = false, cwd = root) {
    if (alive(owned[kind])) throw runtimeError('OWNED_PROCESS_ALREADY_RUNNING_' + kind);
    const options = { cwd, env, windowsHide:true, detached:process.platform === 'win32', stdio:ipc ? ['ignore','pipe','pipe','ipc'] : ['ignore','pipe','pipe'] };
    const child = ipc ? fork(executable,args,{...options,execArgv:[]})
      : kind === 'frontend' || executable.endsWith('.js') ? spawn(process.execPath,[executable,...args],options) : spawn(executable,args,options);
    owned[kind] = child; child.stdout.on('data',()=>{}); child.stderr.on('data',()=>{});
    child.on('error',()=>console.error('Owned ' + kind + ' process could not start.'));
    return child;
  }
  async function stopChild(kind) {
    const child = owned[kind]; if (!alive(child)) return;
    if (kind === 'backend' && child.connected) child.send({action:'shutdown'}); else child.kill('SIGTERM');
    const end = Date.now()+20000;
    while (alive(child) && Date.now()<end) await sleep(100);
    if (alive(child)) throw runtimeError('OWNED_PROCESS_STOP_TIMEOUT_' + kind);
  }
  async function startBackend(accepting) {
    const child = own('backend',path.join(root,'backend/dist/main.js'),[],{...config.env,VNPAY_ACCEPT_NEW_PAYMENTS:String(accepting)},true);
    const ready = await new Promise((resolve,reject) => {
      const timer = setTimeout(()=>reject(runtimeError('BACKEND_START_TIMEOUT')),30000);
      child.once('exit',()=>{clearTimeout(timer);reject(runtimeError('BACKEND_START_FAILED'));});
      child.on('message',m=>{if(m?.type === 'backend-ready') {clearTimeout(timer);resolve(m);}});
      child.once('error',()=>{clearTimeout(timer);reject(runtimeError('BACKEND_SPAWN_FAILED'));});
    });
    if (ready.provider !== mode || !ready.queryDrExternalOff || (mode === 'VNPAY_SANDBOX' && ready.acceptingNewPayments !== accepting)) throw runtimeError('BACKEND_EFFECTIVE_CONFIG_FAILED');
    backendSnapshot = { ...ready, pid:child.pid }; await health('http://127.0.0.1:3001');
  }
  async function startCallbacks() {
    if (!alive(owned.ingress)) {
      await assertPortsFree([3102]); own('ingress',path.join(root,'backend/dist/callback-ingress/main.js'),[],config.env);
      const deadline=Date.now()+10000;
      for (;;) { try { await callbackSmoke('http://127.0.0.1:3102'); break; } catch { if(Date.now()>=deadline)throw runtimeError('INGRESS_NOT_READY'); await sleep(200); } }
    }
    if (!alive(owned.ngrok)) {
      const overlay = path.join(runtimeDir,'ngrok-runtime.yml');
      fs.writeFileSync(overlay,'version: 3\nagent:\n  web_addr: false\n  inspect_db_size: -1\n  log: false\n  console_ui: false\n  remote_management: false\n  update_check: false\n');
      own('ngrok',config.ngrokExecutable,['http','127.0.0.1:3102','--url',config.callbackOrigin,'--inspect=false','--log=false','--config',config.ngrokConfig+','+overlay],config.env);
    }
    const deadline=Date.now()+20000;
    for (;;) {
      try { if(!alive(owned.ngrok))throw runtimeError('NGROK_EXITED');callback=await callbackSmoke(config.callbackOrigin);break; }
      catch { if(!alive(owned.ngrok)||Date.now()>=deadline)throw runtimeError('PUBLIC_CALLBACK_NOT_READY');await sleep(400); }
    }
  }
  async function verifyServices() {
    if (!alive(owned.backend) || !alive(owned.frontend)) throw runtimeError('OWNED_APP_EXITED');
    await health('http://127.0.0.1:3001');
    const front = await fetch('http://127.0.0.1:3000',{signal:AbortSignal.timeout(5000)});await front.body?.cancel();
    if(front.status!==200)throw runtimeError('FRONTEND_HEALTH_FAILED');
    if (mode === 'VNPAY_SANDBOX') {
      if(!alive(owned.ingress)||!alive(owned.ngrok))throw runtimeError('OWNED_CALLBACK_EXITED');
      const r=await fetch(config.callbackOrigin+'/payments/vnpay/return',{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(6000)});await r.body?.cancel();
      if(r.status!==303||r.headers.get('location')!=='http://localhost:3000/payments/vnpay/result')throw runtimeError('PUBLIC_CALLBACK_UNHEALTHY');
      callback={healthy:true,checkedAt:new Date().toISOString()};
    }
  }
  async function cleanup() {
    closing=true;clearInterval(monitor);
    for(const kind of ['ngrok','ingress','frontend','backend'])await stopChild(kind);
    if(controlServer)await new Promise(resolve=>controlServer.close(resolve));
    if(fs.existsSync(stateFile))fs.unlinkSync(stateFile);if(fs.existsSync(lockFile))fs.unlinkSync(lockFile);
  }
  async function shutdown() {
    try { const result = await coordinator.stop(); if(result.stopped) {setTimeout(()=>cleanup().catch(()=>{}),100);} return result; }
    catch { coordinator.status='STOP_REFUSED_CONTINUITY_RETAINED';return {stopped:false,error:'Cannot prove safe shutdown; callback processes retained.'}; }
  }
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
    if(!startupComplete){stopRequested=true;console.log('Shutdown requested; completing startup safely.');return;}
    void serialize(async()=>{const r=await shutdown();if(!r.stopped)console.log('STOP REFUSED: drain enabled; callbacks retained. Use npm run dev:status.');});
  });
  try {
    await assertPortsFree(mode==='VNPAY_SANDBOX'?[3000,3001,3102,4040]:[3000,3001]);
    const baseEnv={...process.env,NEXT_PUBLIC_API_BASE_URL:'http://localhost:3001',NEXT_TELEMETRY_DISABLED:'1'};delete baseEnv.NODE_OPTIONS;
    await build('prisma/build/index.js',['generate'],path.join(root,'backend'),baseEnv,'prisma-client');
    await build('@nestjs/cli/bin/nest.js',['build'],path.join(root,'backend'),baseEnv,'backend');
    config=loadConfiguration(root,mode);frontendBuild=sourceCopy();
    await build('next/dist/bin/next',['build'],frontendBuild,{...baseEnv,NODE_ENV:'production'},'frontend');
    const io={ dependencies:()=>dependencies(config.env.DATABASE_URL), startBackend,
      restartBackend:async accepting=>{await stopChild('backend');await startBackend(accepting);}, startCallbacks,
      startFrontend:async()=>{
        own('frontend',require.resolve('next/dist/bin/next'),['start','--hostname','127.0.0.1','--port','3000'],{...config.env,NODE_ENV:'production'},false,frontendBuild);
        const end=Date.now()+15000;for(;;){try{const r=await fetch('http://127.0.0.1:3000',{signal:AbortSignal.timeout(2000)});await r.body?.cancel();if(r.status===200)break;}catch{ /* Bounded startup polling. */ }if(Date.now()>=end)throw runtimeError('FRONTEND_START_TIMEOUT');await sleep(200);}
      }, verifyServices, stopAll:async()=>{for(const k of ['ngrok','ingress','frontend','backend'])await stopChild(k);} };
    coordinator=new RuntimeCoordinator(mode,io);
    controlServer=http.createServer((req,res)=>{
      if(req.headers.authorization!=='Bearer '+token){res.writeHead(403).end();return;}
      const action=req.url?.slice(1), valid=['status','stop','restart-backend','drain','recover'];
      if(!valid.includes(action)||(action==='status'?req.method!=='GET':req.method!=='POST')){res.writeHead(404).end();return;}
      void serialize(async()=>{
        let result;
        if(action==='status'){
          let servicesHealthy=false;try{await verifyServices();servicesHealthy=true;}catch{ /* Report unhealthy without changing admission from a GET. */ }
          result={...report(),servicesHealthy,dependencies:await dependencies(config.env.DATABASE_URL)};
        }
        if(action==='stop')result=await shutdown();
        if(action==='restart-backend'){await coordinator.restart();result=report();}
        if(action==='drain'){await coordinator.drain();result=report();}
        if(action==='recover'){await coordinator.recover();result=report();}
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));
      }).catch(()=>{res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'CONTROL_FAILED',status:coordinator.status}));});
    });
    await new Promise(resolve=>controlServer.listen(0,'127.0.0.1',resolve));
    fs.writeFileSync(stateFile,JSON.stringify({launcherPid:process.pid,controlPort:controlServer.address().port,controlToken:token}),{mode:0o600});
    await serialize(()=>coordinator.start());startupComplete=true;console.log(JSON.stringify(report(),null,2));
    monitor=setInterval(()=>{if(!closing)void serialize(()=>coordinator.check());},30000);
    if(stopRequested)await serialize(shutdown);
  } catch (error) {
    console.error(error.code || 'STARTUP_FAILED_PRIVATE_DETAILS_SUPPRESSED');
    // Never tear down a partially started VNPAY runtime with unknown/pending state.
    if(mode==='VNPAY_SANDBOX' && alive(owned.backend)) {
      if(coordinator?.accepting) {try{await coordinator.drain();}catch{console.error('DRAIN_FAILED_CALLBACKS_RETAINED');return;}}
      let safe=false;try{safe=(await dependencies(config.env.DATABASE_URL)).safeToStop;}catch{ /* A failed audit must retain callbacks. */ }
      if(!safe){startupComplete=true;if(coordinator)coordinator.status='STARTUP_FAILED_CALLBACK_RECOVERY_REQUIRED';console.error('Callback continuity retained; inspect npm run dev:status.');return;}
    }
    await cleanup();throw error;
  }
}

if(require.main===module){const action=process.argv[2]||'start';
  (action==='start'?start(process.argv[3]||'MOCK'):control(action)).catch(e=>{console.error(e.code || 'RUNTIME_COMMAND_FAILED');process.exitCode=1;});
}
module.exports={start,control,sourceCopy};
