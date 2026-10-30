import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PrismaClient, type UserRole } from '../../src/generated/prisma/client';
import { utcConnectionString } from '../../src/database/pg-connection';
import { configureApp } from '../../src/common/configure-app';
import { IngredientService } from '../../src/ingredients/ingredient.service';
import { requestHash } from '../../src/ingredients/ingredient-policy';
import { ingredientCatalog } from '../../src/ingredients/ingredient-catalog';

const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString)throw Error('Explicit isolated TEST_DATABASE_URL required');
const url=new URL(connectionString);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/_test$/.test(url.pathname))throw Error('Local test database only');
const schema='brewlite_i01_test_'+randomUUID().replaceAll('-','');
const sql=new Client({connectionString});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:utcConnectionString(connectionString,`-c search_path=${schema}`)},{schema})});
type Actor={id:string;token:string};
type Receipt=Awaited<ReturnType<IngredientService['createReceipt']>>;
type Count=Awaited<ReturnType<IngredientService['createCount']>>;
let app:NestExpressApplication,jwt:JwtService,admin:Actor,admin2:Actor,staff:Actor,staff2:Actor,customer:Actor;
async function actor(role:UserRole):Promise<Actor>{const u=await db.user.create({data:{email:randomUUID()+'@example.invalid',passwordHash:'isolated-test-only',role}});return{id:u.id,token:jwt.sign({sub:u.id,role:'ADMIN'})};}
function api(method:'get'|'post',path:string,who?:Actor,body?:object,key?:string){const call=request(app.getHttpServer())[method]('/ingredient-inventory/'+path);if(who)call.set('Authorization','Bearer '+who.token);if(key)call.set('Idempotency-Key',key);return body?call.send(body):call;}
async function ingredient(unit='L',threshold=unit==='L'?'5':'10'){const r=await api('post','ingredients',admin,{name:'Nguyên liệu '+randomUUID(),unit,lowStockThreshold:threshold},randomUUID()).expect(201);return(r.body as {id:string}).id;}
async function receipt(id:string,q:string,who=admin,key=randomUUID()){const r=await api('post','receipts',who,{note:'Nhận hàng',lines:[{ingredientId:id,quantity:q}]},key).expect(201);return r.body as Receipt;}
function confirm(doc:Receipt,who=admin){return api('post',`receipts/${doc.id}/confirm`,who,{expectedVersion:0});}
async function count(id:string,actual:string,who=staff,recountOfId?:string){const i=await db.ingredient.findUniqueOrThrow({where:{id}});const r=await api('post','counts',who,{note:'Kiểm kê cuối ca',lines:[{ingredientId:id,expectedVersion:i.version,actualQuantity:actual,note:'Đã kiểm tra tại quầy'}],...(recountOfId?{recountOfId}:{})},randomUUID()).expect(201);return r.body as Count;}
function review(doc:Count,action='APPROVE',note='',who=admin){return api('post',`counts/${doc.id}/review`,who,{expectedVersion:0,action,note});}
const stock=(id:string)=>db.ingredient.findUniqueOrThrow({where:{id}});
beforeAll(async()=>{
  await sql.connect();await sql.query(`CREATE SCHEMA "${schema}"`);await sql.query(`SET search_path TO "${schema}"`);
  const dir=resolve(__dirname,'../../prisma/migrations');for(const name of readdirSync(dir).filter(n=>/^\d+_/.test(n)).sort())await sql.query(readFileSync(resolve(dir,name,'migration.sql'),'utf8'));
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(db).compile();
  app=module.createNestApplication<NestExpressApplication>({bodyParser:false});configureApp(app);await app.init();jwt=app.get(JwtService);
  admin=await actor('ADMIN');admin2=await actor('ADMIN');staff=await actor('STAFF');staff2=await actor('STAFF');customer=await actor('CUSTOMER');
});
afterAll(async()=>{if(app)await app.close();await db.$disconnect();await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await sql.end();});

test('empty inventory, private headers, Staff read and Customer/guest denial',async()=>{
  const r=await api('get','ingredients',staff).expect(200);expect(r.body).toEqual({items:[]});expect(r.headers['cache-control']).toContain('no-store');expect(r.headers.vary).toContain('Authorization');
  await api('get','ingredients').expect(401);await api('get','ingredients',customer).expect(403);
  const summary=await api('get','summary',admin).expect(200);expect(summary.body).toEqual({totalIngredients:0,inStock:0,lowStock:0,outOfStock:0,pendingCounts:0});await api('get','summary',customer).expect(403);
});
test.each(['-1','1.0001','NaN','1e3','1000000000','1,5',1.5,null])('invalid quantity %p rejected before creation',async value=>{
  await api('post','ingredients',admin,{name:'Invalid',unit:'L',lowStockThreshold:value},randomUUID()).expect(400);
});
test('PIECE disallows fractional values; names normalize and create replay does not duplicate',async()=>{
  await api('post','ingredients',admin,{name:'Ly',unit:'PIECE',lowStockThreshold:'1.5'},randomUUID()).expect(422);
  const key=randomUUID(),body={name:'  Ly   nhựa  ',unit:'PIECE',lowStockThreshold:'10'};
  const a=await api('post','ingredients',admin,body,key).expect(201),b=await api('post','ingredients',admin,body,key).expect(201);expect(a.body).toEqual(b.body);
  await api('post','ingredients',admin,{...body,name:'Ly khác'},key).expect(409);
  await api('post','ingredients',admin,{...body,name:'LY NHỰA'},randomUUID()).expect(409);
  await api('post','ingredients',staff,body,randomUUID()).expect(403);
});
test('fractional receipt draft does not alter stock; confirmation logs before/after once',async()=>{
  const id=await ingredient(),doc=await receipt(id,'15.5');expect((await stock(id)).quantity.toFixed(3)).toBe('0.000');expect(doc.status).toBe('DRAFT');
  const result=await confirm(doc).expect(200);const body=result.body as Receipt;expect(body.status).toBe('CONFIRMED');expect(body.lines[0].movement).toMatchObject({beforeQuantity:'0.000',afterQuantity:'15.500',delta:'15.500',actor:{id:admin.id}});
  await confirm(doc,admin2).expect(200);expect((await stock(id)).quantity.toFixed(3)).toBe('15.500');expect(await db.ingredientMovement.count({where:{ingredientId:id}})).toBe(1);
});
test('receipt duplicate key replays; changed body conflicts; zero/piece/duplicate lines fail',async()=>{
  const id=await ingredient(),key=randomUUID(),body={lines:[{ingredientId:id,quantity:'1.25'}]};
  const a=await api('post','receipts',admin,body,key).expect(201),b=await api('post','receipts',admin,body,key).expect(201);expect((a.body as Receipt).id).toBe((b.body as Receipt).id);
  await api('post','receipts',admin,{lines:[{ingredientId:id,quantity:'2'}]},key).expect(409);
  await api('post','receipts',admin,{lines:[{ingredientId:id,quantity:'0'}]},randomUUID()).expect(422);
  await api('post','receipts',admin,{lines:[...body.lines,...body.lines]},randomUUID()).expect(400);
  const piece=await ingredient('PIECE','10');await api('post','receipts',admin,{lines:[{ingredientId:piece,quantity:'1.5'}]},randomUUID()).expect(422);
});
test('Staff cannot import, approve, view movements or use forged JWT role',async()=>{
  const id=await ingredient(),doc=await receipt(id,'3'),c=await count(id,'1');
  for(const who of [staff,customer]){await confirm(doc,who).expect(403);await review(c,'APPROVE','',who).expect(403);await api('post','receipts',who,{lines:[{ingredientId:id,quantity:'3'}]},randomUUID()).expect(403);await api('get','receipts',who).expect(403);await api('get','movements',who).expect(403);}
  await api('post','counts',admin,{lines:[{ingredientId:id,actualQuantity:'1',expectedVersion:0}]},randomUUID()).expect(403);
});
test('Staff submission only captures actual/difference; Admin approval changes official stock',async()=>{
  const id=await ingredient();await confirm(await receipt(id,'10')).expect(200);const doc=await count(id,'8.25');
  expect(doc.lines[0]).toMatchObject({systemQuantity:'10.000',actualQuantity:'8.250',difference:'-1.750',note:'Đã kiểm tra tại quầy'});expect((await stock(id)).quantity.toFixed(3)).toBe('10.000');
  const reviewed=await review(doc).expect(200);expect((reviewed.body as Count).status).toBe('APPROVED');expect((await stock(id)).quantity.toFixed(3)).toBe('8.250');
  await review(doc,'APPROVE','',admin2).expect(200);expect(await db.ingredientMovement.count({where:{countLine:{countId:doc.id}}})).toBe(1);
});
test('zero difference and zero actual are valid; positive/fractional piece rules still enforced',async()=>{
  const id=await ingredient(),doc=await count(id,'0');await review(doc).expect(200);const movements=await db.ingredientMovement.findMany({where:{ingredientId:id}});expect(movements).toHaveLength(1);expect(movements[0].delta.toFixed(3)).toBe('0.000');
  const piece=await ingredient('PIECE','10');await api('post','counts',staff,{lines:[{ingredientId:piece,expectedVersion:0,actualQuantity:'1.1'}]},randomUUID()).expect(422);
});
test('receipt arriving during review cannot be overwritten; request recount records a new snapshot',async()=>{
  const id=await ingredient();await confirm(await receipt(id,'10')).expect(200);const old=await count(id,'8');await confirm(await receipt(id,'20')).expect(200);
  const denied=await review(old).expect(409);expect((denied.body as {error:{code:string}}).error.code).toBe('INVENTORY_CHANGED');expect((await stock(id)).quantity.toFixed(3)).toBe('30.000');expect((await db.ingredientCount.findUniqueOrThrow({where:{id:old.id}})).status).toBe('SUBMITTED');
  await review(old,'REQUEST_RECOUNT','Đã nhập thêm 20 lít').expect(200);const newer=await count(id,'29',staff,old.id);expect(newer.lines[0].systemQuantity).toBe('30.000');await review(newer).expect(200);expect((await stock(id)).quantity.toFixed(3)).toBe('29.000');
  const list=await api('get','counts',staff).expect(200);const docs=(list.body as {items:Count[]}).items;expect(docs.find(c=>c.id===old.id)?.replacementId).toBe(newer.id);
  const sameVersion=await stock(id);await api('post','counts',staff,{recountOfId:old.id,lines:[{ingredientId:id,expectedVersion:sameVersion.version,actualQuantity:'29'}]},randomUUID()).expect(409);
  await api('post','counts',staff2,{recountOfId:old.id,lines:[{ingredientId:id,expectedVersion:sameVersion.version,actualQuantity:'29'}]},randomUUID()).expect(404);
});
test('rejection/recount require a reason, preserve stock/history, and cannot later approve',async()=>{
  const id=await ingredient(),doc=await count(id,'3');await review(doc,'REJECT',' ').expect(400);await review(doc,'REQUEST_RECOUNT','').expect(400);await review(doc,'REJECT','Nhập nhầm số lượng').expect(200);await review(doc).expect(409);expect((await stock(id)).quantity.toFixed(3)).toBe('0.000');expect(await db.ingredientMovement.count({where:{ingredientId:id}})).toBe(0);
});
test('stale Staff snapshot and client-forged stock/difference/actor/status are rejected',async()=>{
  const id=await ingredient();await confirm(await receipt(id,'2')).expect(200);const body={lines:[{ingredientId:id,expectedVersion:0,actualQuantity:'1'}]};await api('post','counts',staff,body,randomUUID()).expect(409);
  for(const extra of [{status:'APPROVED'},{createdById:admin.id},{stock:'99'},{difference:'1'}])await api('post','counts',staff,{...body,...extra},randomUUID()).expect(400);
  await api('get','ingredients?stock=1',staff).expect(400);await api('get','ingredients',staff,{quantity:'1'}).expect(400);
});
test('Staff history contains own counts only; count creation is replay-safe',async()=>{
  const id=await ingredient(),key=randomUUID(),body={lines:[{ingredientId:id,expectedVersion:0,actualQuantity:'2'}]};const a=await api('post','counts',staff2,body,key).expect(201),doc=a.body as Count;await review(doc).expect(200);
  const replay=await api('post','counts',staff2,body,key).expect(201);expect((replay.body as Count).id).toBe(doc.id);expect((await stock(id)).quantity.toFixed(3)).toBe('2.000');
  const own=await api('get','counts',staff).expect(200);expect((own.body as {items:Count[]}).items.some(c=>c.id===doc.id)).toBe(false);
  await api('post','counts',staff2,{lines:[{...body.lines[0],actualQuantity:'3'}]},key).expect(409);
});
test('concurrent confirmations and approvals apply each document exactly once',async()=>{
  const id=await ingredient(),doc=await receipt(id,'6');const results=await Promise.all([confirm(doc),confirm(doc,admin2)]);for(const r of results)expect([200,409]).toContain(r.status);await confirm(doc).expect(200);expect((await stock(id)).quantity.toFixed(3)).toBe('6.000');expect(await db.ingredientMovement.count({where:{ingredientId:id}})).toBe(1);
  const c=await count(id,'4');const approvals=await Promise.all([review(c),review(c,'APPROVE','',admin2)]);for(const r of approvals)expect([200,409]).toContain(r.status);await review(c).expect(200);expect((await stock(id)).quantity.toFixed(3)).toBe('4.000');expect(await db.ingredientMovement.count({where:{countLine:{countId:c.id}}})).toBe(1);
});
test('two stale counts cannot both overwrite; changed version with same quantity also blocks',async()=>{
  const id=await ingredient(),a=await count(id,'1'),b=await count(id,'2');await review(a).expect(200);await review(b).expect(409);expect((await stock(id)).quantity.toFixed(3)).toBe('1.000');const c=await count(id,'1');await review(c).expect(200);expect((await stock(id)).version).toBe(2);
});
test('simultaneous import and approval serialize without losing the newly imported quantity',async()=>{
  const id=await ingredient();await confirm(await receipt(id,'10')).expect(200);const c=await count(id,'8'),r=await receipt(id,'20');
  const results=await Promise.all([review(c,'APPROVE','',admin),confirm(r,admin2)]);for(const x of results)expect([200,409]).toContain(x.status);
  await confirm(r,admin2).expect(200);const saved=await db.ingredientCount.findUniqueOrThrow({where:{id:c.id}});
  expect((await stock(id)).quantity.toFixed(3)).toBe(saved.status==='APPROVED'?'28.000':'30.000');
  if(saved.status==='SUBMITTED')await review(c).expect(409);
});
test('multi-line stock and journal roll back together on a movement failure',async()=>{
  const a=await ingredient(),b=await ingredient();const made=await api('post','receipts',admin,{lines:[{ingredientId:a,quantity:'2'},{ingredientId:b,quantity:'3'}]},randomUUID()).expect(201);const doc=made.body as Receipt;
  await sql.query(`CREATE FUNCTION i01_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ingredient_id='${b}'::uuid THEN RAISE EXCEPTION 'isolated fault'; END IF; RETURN NEW; END; $$; CREATE TRIGGER i01_test_fail BEFORE INSERT ON ingredient_movements FOR EACH ROW EXECUTE FUNCTION i01_test_fail()`);
  try{const result=await confirm(doc);expect([409,503]).toContain(result.status);expect((await stock(a)).quantity.toFixed(3)).toBe('0.000');expect((await stock(b)).quantity.toFixed(3)).toBe('0.000');expect((await db.ingredientReceipt.findUniqueOrThrow({where:{id:doc.id}})).status).toBe('DRAFT');expect(await db.ingredientMovement.count({where:{receiptLine:{receiptId:doc.id}}})).toBe(0);}
  finally{await sql.query('DROP TRIGGER i01_test_fail ON ingredient_movements; DROP FUNCTION i01_test_fail()');}
  await confirm(doc).expect(200);expect((await stock(a)).quantity.toFixed(3)).toBe('2.000');
});
test('overflow leaves draft untouched; movement ledger is append-only',async()=>{
  const id=await ingredient();await confirm(await receipt(id,'999999999.999')).expect(200);const doc=await receipt(id,'0.001');await confirm(doc).expect(409);expect((await stock(id)).quantity.toFixed(3)).toBe('999999999.999');const m=await db.ingredientMovement.findFirstOrThrow({where:{ingredientId:id}});await expect(sql.query('UPDATE ingredient_movements SET delta=delta WHERE id=$1',[m.id])).rejects.toThrow('append-only');
});
test('history pagination does not lose records or mix Staff owners',async()=>{
  const who=await actor('STAFF'),id=await ingredient(),ids=Array.from({length:55},()=>randomUUID());await db.ingredientCount.createMany({data:ids.map(id=>({id,createdById:who.id,requestKey:randomUUID(),requestHash:'0'.repeat(64)}))});await db.ingredientCountLine.createMany({data:ids.map(countId=>({id:randomUUID(),countId,ingredientId:id,systemQuantity:'0',actualQuantity:'0',ingredientVersion:0}))});
  const a=await api('get','counts',who).expect(200),page=a.body as {items:Count[];nextCursor:string};expect(page.items).toHaveLength(50);expect(page.nextCursor).toBeTruthy();const b=await api('get','counts?cursor='+page.nextCursor,who).expect(200);const second=b.body as {items:Count[];nextCursor:null};expect(second.items).toHaveLength(5);expect(new Set([...page.items,...second.items].map(c=>c.id)).size).toBe(55);expect(second.nextCursor).toBeNull();
  const summary=await api('get','summary',who).expect(200);expect((summary.body as {pendingCounts:number}).pendingCounts).toBe(55);const all=await api('get','summary',admin).expect(200);expect((all.body as {pendingCounts:number}).pendingCounts).toBeGreaterThanOrEqual(55);
});
test('inventory operations leave existing product/order/payment/loyalty rows untouched',async()=>{
  const p=await db.product.create({data:{name:'Existing product',price:'40000',imageUrl:'/images/latte.svg',stock:8,isActive:true}});const users=await db.user.findMany({orderBy:{id:'asc'}});const id=await ingredient();await confirm(await receipt(id,'10')).expect(200);await review(await count(id,'9')).expect(200);expect(await db.product.findUniqueOrThrow({where:{id:p.id}})).toEqual(p);expect(await db.user.findMany({orderBy:{id:'asc'}})).toEqual(users);expect(await db.order.count()).toBe(0);expect(await db.payment.count()).toBe(0);expect(await db.loyaltyEntry.count()).toBe(0);
});

test.each([['PIECE','10','9','11'],['L','5','4.999','5.001'],['KG','10','9.999','10.001'],['EGG','10','9','11']] as const)('%s uses fixed threshold and strict boundaries in list and summary',async(unit,limit,below,above)=>{
  const made=await api('post','ingredients',admin,{name:'I02 '+randomUUID(),unit},randomUUID()).expect(201),id=(made.body as {id:string}).id;
  for(const [quantity,status]of [['0','OUT_OF_STOCK'],[below,'LOW_STOCK'],[limit,'IN_STOCK'],[above,'IN_STOCK']]){
    await db.ingredient.update({where:{id},data:{quantity}});
    const all=await api('get','ingredients',admin).expect(200),items=(all.body as {items:{id:string;status:string;lowStockThreshold:string}[]}).items;
    expect(items.find(i=>i.id===id)).toMatchObject({status,lowStockThreshold:Number(limit).toFixed(3)});
    const summary=await api('get','summary',admin).expect(200);expect(summary.body).toMatchObject({totalIngredients:items.length,inStock:items.filter(i=>i.status==='IN_STOCK').length,lowStock:items.filter(i=>i.status==='LOW_STOCK').length,outOfStock:items.filter(i=>i.status==='OUT_OF_STOCK').length});
  }
  await expect(db.ingredient.update({where:{id},data:{lowStockThreshold:'2'}})).rejects.toThrow();
});
test('fixed thresholds reject new overrides while historical exact creation replay stays valid',async()=>{
  const name='Legacy '+randomUUID(),key=randomUUID(),oldBody={name,unit:'L',lowStockThreshold:'2'};
  const saved=await db.ingredient.create({data:{name,normalizedName:name.toLocaleLowerCase('vi'),unit:'L',lowStockThreshold:'5',createdById:admin.id,requestKey:key,requestHash:requestHash({name,unit:'L',threshold:'2.000'})}});
  const replay=await api('post','ingredients',admin,oldBody,key).expect(201);expect((replay.body as {id:string}).id).toBe(saved.id);
  await api('post','ingredients',admin,{...oldBody,name:'New '+randomUUID()},randomUUID()).expect(400);
  for(const unit of ['G','ML'])await api('post','ingredients',admin,{name:randomUUID(),unit},randomUUID()).expect(400);
});

test('catalog initialization requires Admin, strict empty input, reuses existing stock and creates only missing real definitions',async()=>{
  const beforeCount=await db.ingredient.count();for(const who of [staff,customer])await api('post','catalog/initialize',who,{}).expect(403);await api('post','catalog/initialize',undefined,{}).expect(401);
  await api('post','catalog/initialize',admin,{quantity:'999'}).expect(400);await api('post','catalog/initialize?unit=L',admin,{}).expect(400);expect(await db.ingredient.count()).toBe(beforeCount);
  const old=await db.ingredient.findUniqueOrThrow({where:{normalizedName:'ly nhựa'}});await confirm(await receipt(old.id,'12')).expect(200);const preserved=await stock(old.id),movements=await db.ingredientMovement.count();
  const first=await api('post','catalog/initialize',admin,{}).expect(200);expect(first.body).toEqual({created:11,existing:1});expect(await stock(old.id)).toEqual(preserved);expect(await db.ingredientMovement.count()).toBe(movements);
  const saved=await db.ingredient.findMany({where:{normalizedName:{in:ingredientCatalog.map(i=>i.name.toLocaleLowerCase('vi'))}}});expect(saved).toHaveLength(12);
  for(const definition of ingredientCatalog){const row=saved.find(i=>i.normalizedName===definition.name.toLocaleLowerCase('vi'))!;expect(row.unit).toBe(definition.unit);if(row.id!==old.id){expect(row.quantity.toFixed(3)).toBe('0.000');expect(row.version).toBe(0);expect(row.createdById).toBe(admin.id);}}
  const snapshot=await db.ingredient.findMany({orderBy:{id:'asc'}});for(const who of [admin,admin2]){const retry=await api('post','catalog/initialize',who,{}).expect(200);expect(retry.body).toEqual({created:0,existing:12});}expect(await db.ingredient.findMany({orderBy:{id:'asc'}})).toEqual(snapshot);
});
test('catalog unit conflict is explicit and never rewrites stock, unit or history',async()=>{
  const egg=await db.ingredient.findUniqueOrThrow({where:{normalizedName:'trứng'}});await db.ingredient.update({where:{id:egg.id},data:{unit:'L',lowStockThreshold:'5'}});
  const before=await db.ingredient.findMany({orderBy:{id:'asc'}});
  try{const response=await api('post','catalog/initialize',admin,{}).expect(409);expect((response.body as {error:{code:string}}).error.code).toBe('INGREDIENT_UNIT_MISMATCH');expect(await db.ingredient.findMany({orderBy:{id:'asc'}})).toEqual(before);}
  finally{await db.ingredient.update({where:{id:egg.id},data:{unit:'EGG',lowStockThreshold:'10'}});}
});
test('egg receipts/count approvals use whole eggs and journal once',async()=>{
  const egg=await db.ingredient.findUniqueOrThrow({where:{normalizedName:'trứng'}});await api('post','receipts',admin,{lines:[{ingredientId:egg.id,quantity:'1.5'}]},randomUUID()).expect(422);
  await confirm(await receipt(egg.id,'12')).expect(200);await api('post','counts',staff,{lines:[{ingredientId:egg.id,expectedVersion:1,actualQuantity:'9.5'}]},randomUUID()).expect(422);
  const doc=await count(egg.id,'9');await review(doc).expect(200);await review(doc).expect(200);expect((await stock(egg.id)).quantity.toFixed(3)).toBe('9.000');expect(await db.ingredientMovement.count({where:{ingredientId:egg.id}})).toBe(2);
  await expect(db.ingredient.update({where:{id:egg.id},data:{quantity:'9.5'}})).rejects.toThrow();
});
