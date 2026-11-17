import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { utcConnectionString } from '../../src/database/pg-connection';
import { configureApp } from '../../src/common/configure-app';
import { IngredientService } from '../../src/ingredients/ingredient.service';


import { PaymentExpirationWorker } from '../../src/orders/payment-expiration.worker';
import { PaymentReceiptWorker } from '../../src/payments/payment-receipt.worker';

import { SANDBOX_PAYMENT_URL } from '../../src/payments/vnpay/vnpay-config';
import type { OrderService } from '../../src/orders/order.service';
const trackingBody=(response:{body:unknown})=>response.body as Awaited<ReturnType<OrderService['tracking']>>;
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString||!['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname)||!/_test$/.test(new URL(connectionString).pathname))throw Error('Explicit local test database required');
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
describe.each(['uuid','text'])('order aftercare with %s identities',storage=>{
 const schema='aftercare_'+randomUUID().replaceAll('-',''),sql=new Client({connectionString});
 const db=Object.assign(new PrismaClient({adapter:new PrismaPg({connectionString:utcConnectionString(connectionString,`-c search_path=${schema}`)},{schema})}),{transactionOptions:{maxWait:2000,timeout:5000}});
 const profile={environment:'SANDBOX',version:'2.1.0',merchantCode:'TEST0001',hashSecret:'synthetic-order-aftercare-secret-only',paymentUrl:SANDBOX_PAYMENT_URL,returnUrl:'https://callback.example.org/payments/vnpay/return',ipnUrl:'https://callback.example.org/payments/vnpay/ipn'};
 let app:NestExpressApplication,jwt:JwtService,admin:string,staff:string,other:string;
 const auth=(id:string)=>'Bearer '+jwt.sign({sub:id});
 const post=(actor:string,path:string,body:object={})=>request(app.getHttpServer()).post(path).set('Authorization',auth(actor)).send(body);
 const cancel=(f:{user:string;id:string})=>post(f.user,`/orders/${f.id}/cancel`);
 const tracking=(actor:string,id:string)=>request(app.getHttpServer()).get(`/orders/${id}/tracking`).set('Authorization',auth(actor));
 async function transition(id:string,targetStatus:'PREPARING'|'READY'|'COMPLETED'){
  const o=await db.order.findUniqueOrThrow({where:{id}});return post(staff,`/operator/orders/${id}/transitions`,{expectedVersion:o.version,targetStatus});
 }
 const refund=(id:string,action:string,expectedVersion:number,extra:object={})=>post(admin,`/admin/orders/${id}/refund`,{expectedVersion,action,...extra});
 async function support(f:{user:string;id:string},reason='Test service issue',key=randomUUID()){
  return request(app.getHttpServer()).post(`/orders/${f.id}/support-requests`).set('Authorization',auth(f.user)).set('Idempotency-Key',key).send({reason});
 }
 async function review(id:string,requestId:string,action='APPROVE',note='Verified service issue',expectedVersion=0){return post(admin,`/admin/orders/${id}/support-requests/${requestId}/review`,{action,note,expectedVersion});}
 // Synthetic snapshots are created only in this isolated test schema. The
 // restoration does not change catalog/pricing/create-order in the clone.
 async function fixture(age=30,zero=false){
  const user=(await db.user.create({data:{id:randomUUID(),email:randomUUID()+'@example.invalid',passwordHash:'synthetic-only'}})).id;
  const product=await db.product.create({data:{id:randomUUID(),name:'Latte',stock:0,price:zero?'0':'10000',imageUrl:'/images/latte.svg',sizes:{create:{size:'S',extraPrice:'0'}}}});
  const id=randomUUID(),total=zero?'0':'10000',points=zero?0:1;
  await db.order.create({data:{id,orderCode:'TEST-'+randomUUID(),userId:user,status:'PENDING',subtotal:total,total}});
  await db.orderItem.create({data:{id:randomUUID(),orderId:id,productId:product.id,productNameSnapshot:'Latte',size:'S',basePrice:total,sizeExtraPrice:'0',unitPrice:total,qty:1,lineTotal:total,ingredientKeysSnapshot:['i07:synthetic|L']}});
  const ingredient=await db.ingredient.findFirstOrThrow({where:{name:'Sữa tươi không đường (công thức)'}});
  await db.ingredient.update({where:{id:ingredient.id},data:{reservedQuantity:{increment:'0.150'}}});
  const reservation=await db.ingredientReservation.create({data:{id:randomUUID(),orderId:id,ingredientId:ingredient.id,nameSnapshot:'Sữa tươi không đường',unitSnapshot:'L',quantity:'0.150'}});
  await db.ingredientMovement.create({data:{id:randomUUID(),ingredientId:ingredient.id,reservationId:reservation.id,reservationAction:'RESERVE',reservationCycle:1,beforeQuantity:ingredient.quantity,afterQuantity:ingredient.quantity,delta:'0',actorId:user}});
  await db.order.update({where:{id},data:{status:'PAID',paidAt:new Date(Date.now()-age*1000),version:{increment:1}}});
  await db.loyaltyAward.create({data:{id:randomUUID(),orderId:id,userId:user,points,createdAt:new Date('2000-01-01T00:00:00Z')}});
  await db.user.update({where:{id:user},data:{loyaltyPoints:points}});
  await db.loyaltyEntry.create({data:{id:randomUUID(),userId:user,kind:'OPENING',points,availableDelta:points,reservedDelta:0,debtDelta:0n,effectKey:'OPENING:'+user}});
  if(!zero){
   const key=randomUUID(),claim=await db.idempotencyRequest.create({data:{id:randomUUID(),userId:user,operation:'PAY_ORDER',idempotencyKey:key,requestHash:'a'.repeat(64),state:'COMPLETED',orderId:id,responseStatus:200,responseBody:{legacy:true},completedAt:new Date()}});
   await db.payment.create({data:{id:randomUUID(),orderId:id,userId:user,idempotencyKey:key,idempotencyRequestId:claim.id,amount:total,method:'CARD',provider:'MOCK',status:'SUCCEEDED'}});
  }
  return {user,id,productId:product.id};
 }
 async function state(id:string){return {order:await db.order.findUniqueOrThrow({where:{id}}),refund:await db.orderRefund.findUnique({where:{orderId:id}}),reservations:await db.ingredientReservation.findMany({where:{orderId:id},orderBy:{id:'asc'}}),events:await db.orderTrackingEvent.findMany({where:{orderId:id},orderBy:{sequence:'asc'}})};}
 beforeAll(async()=>{
  await sql.connect();await sql.query(`CREATE SCHEMA ${quote(schema)}`);await sql.query(`SET search_path TO ${quote(schema)}`);
  const directory=resolve(__dirname,'../../prisma/migrations');for(const name of readdirSync(directory).filter(n=>/^\d+_/.test(n)).sort())await sql.query(readFileSync(resolve(directory,name,'migration.sql'),'utf8'));
  await sql.query("CREATE SEQUENCE loyalty_entries_id_seq");
  if(storage==='text'){
   const constraints=(await sql.query<{table:string;name:string;definition:string}>(`SELECT c.conrelid::regclass::text AS "table",c.conname AS name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype IN ('f','c')`,[schema])).rows;
   for(const row of constraints)await sql.query(`ALTER TABLE ${row.table} DROP CONSTRAINT ${quote(row.name)}`);
   for(const column of (await sql.query<{table_name:string;column_name:string}>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND udt_name='uuid' AND NOT (table_name IN ('order_recipe_ingredients','order_tracking_events','order_support_requests','order_refunds') AND column_name='id') AND NOT (table_name='ingredient_movements' AND column_name='reservation_id') AND NOT (table_name='order_support_requests' AND column_name='request_key')",[schema])).rows)await sql.query(`ALTER TABLE ${quote(column.table_name)} ALTER COLUMN ${quote(column.column_name)} TYPE text USING ${quote(column.column_name)}::text`);
   for(const row of constraints)await sql.query(`ALTER TABLE ${row.table} ADD CONSTRAINT ${quote(row.name)} ${row.definition}`);
  }
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(db).overrideProvider(ConfigService).useValue(new ConfigService({NODE_ENV:'test',JWT_SECRET:'synthetic-order-aftercare-jwt-at-least-32-bytes',JWT_EXPIRES_IN:3600,PAYMENT_PROVIDER_MODE:'VNPAY_SANDBOX',VNPAY_INITIATION_CONFIG:profile,VNPAY_ACCEPT_NEW_PAYMENTS:true})).overrideProvider(PaymentExpirationWorker).useValue({}).overrideProvider(PaymentReceiptWorker).useValue({}).compile();
  app=module.createNestApplication<NestExpressApplication>({bodyParser:false});configureApp(app);await app.init();jwt=app.get(JwtService);
  for(const [id,role]of [[storage==='text'?'411':randomUUID(),'ADMIN'],[storage==='text'?'412':randomUUID(),'STAFF'],[randomUUID(),'CUSTOMER']] as const){await db.user.create({data:{id,role,email:id+'@example.invalid',passwordHash:'synthetic-only'}});if(role==='ADMIN')admin=id;else if(role==='STAFF')staff=id;else other=id;}
  await sql.query("ALTER TABLE loyalty_entries ALTER COLUMN id SET DEFAULT gen_random_uuid()");
  await app.get(IngredientService).initializeCatalog(admin);
 });
 beforeEach(async()=>{await db.ingredientReservation.updateMany({where:{state:'RESERVED'},data:{state:'RELEASED'}});await db.ingredient.updateMany({data:{quantity:'1000',reservedQuantity:'0'}});});
 afterAll(async()=>{if(app)await app.close();await db.$disconnect();await sql.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);await sql.end();});

 test.each([30,119])('customer cancels at %s seconds: one release, reversal and pending cash refund',async age=>{
  const f=await fixture(age),before=await db.ingredient.findMany({orderBy:{id:'asc'}});
  await cancel(f).expect(200);await cancel(f).expect(200);
  const s=await state(f.id);expect(s.order.status).toBe('CANCELLED');expect(s.refund).toMatchObject({status:'PENDING',approvedAt:null});expect(s.refund!.amount.toFixed(0)).toBe('10000');
  expect(s.reservations.every(r=>r.state==='RELEASED')).toBe(true);expect(s.events.filter(e=>e.status==='CANCELLED')).toHaveLength(1);expect(s.events.filter(e=>e.kind==='REFUND')).toHaveLength(1);
  expect((await db.user.findUniqueOrThrow({where:{id:f.user}})).loyaltyPoints).toBe(0);
  expect((await db.payment.findFirstOrThrow({where:{orderId:f.id,status:'SUCCEEDED'}})).amount.toFixed(0)).toBe('10000');
  expect((await db.ingredient.findMany({orderBy:{id:'asc'}})).map(i=>i.quantity.toFixed(3))).toEqual(before.map(i=>i.quantity.toFixed(3)));
 });
 test.each([120,121])('customer cancellation at %s seconds is denied without changing the paid order',async age=>{
  const f=await fixture(age),before=await state(f.id);const r=await cancel(f).expect(409);expect((r.body as {error:{code:string}}).error.code).toBe('CANCEL_WINDOW_EXPIRED');expect(await state(f.id)).toEqual(before);
 });
 test('Staff can prepare immediately without waiting 120s, and progresses through delivery',async()=>{
  const f=await fixture(60);
  const t=await tracking(f.user,f.id).expect(200);expect(t.body).toMatchObject({status:'PAID',canCancelPaid:true,canStartPreparing:true});
  await transition(f.id,'PREPARING').then(r=>expect(r.status).toBe(200));await cancel(f).expect(409);
  const consumed=await db.ingredient.findMany({orderBy:{id:'asc'}});await transition(f.id,'READY').then(r=>expect(r.status).toBe(200));await transition(f.id,'COMPLETED').then(r=>expect(r.status).toBe(200));
  expect(trackingBody(await tracking(f.user,f.id).expect(200)).status).toBe('COMPLETED');expect((await db.ingredient.findMany({orderBy:{id:'asc'}})).map(i=>i.quantity.toFixed(3))).toEqual(consumed.map(i=>i.quantity.toFixed(3)));
 });
 test.each([119,121])('concurrent cancel/prepare at %s seconds cannot both succeed',async age=>{
  const f=await fixture(age);const results=await Promise.all([cancel(f),transition(f.id,'PREPARING')]);expect(results.filter(r=>r.status===200)).toHaveLength(1);
  expect(['CANCELLED','PREPARING']).toContain((await state(f.id)).order.status);
 });
 test('two concurrent paid cancellations create one refund and one release for each ingredient',async()=>{
  const f=await fixture();const results=await Promise.all([cancel(f),cancel(f)]);expect(results.map(r=>r.status)).toEqual([200,200]);expect(await db.orderRefund.count({where:{orderId:f.id}})).toBe(1);
  const rows=await db.ingredientMovement.findMany({where:{reservation:{orderId:f.id},reservationAction:'RELEASE'}});expect(rows).toHaveLength((await state(f.id)).reservations.length);
 });
 test('support is idempotent; after-deadline approval cancels PAID once and authorizes a refund',async()=>{
  const f=await fixture(121),key=randomUUID();const sent=await support(f,'Shop cannot serve',key).then(r=>{expect(r.status).toBe(200);return r.body as {id:string}});
  expect(((await support(f,'Shop cannot serve',key)).body as {id:string}).id).toBe(sent.id);expect((await support(f,'Different reason',key)).status).toBe(409);
  await review(f.id,sent.id).then(r=>expect(r.status).toBe(200));await review(f.id,sent.id).then(r=>expect(r.status).toBe(200));const s=await state(f.id);expect(s.order.status).toBe('CANCELLED');expect(s.refund!.approvedById).toBe(admin);
 });
 test('refund requires approval and evidence, succeeds once, and database protects confirmed history',async()=>{
  const f=await fixture();await cancel(f).expect(200);await refund(f.id,'SUCCEEDED',0,{transactionReference:'test-'+randomUUID(),evidenceReference:'checked external receipt'}).expect(422);
  await refund(f.id,'APPROVE',0).expect(200);await refund(f.id,'SUCCEEDED',1).expect(422);
  const proof={transactionReference:'test-'+randomUUID(),evidenceReference:'Synthetic verified bank statement'};
  await refund(f.id,'SUCCEEDED',1,proof).expect(200);await refund(f.id,'SUCCEEDED',1,proof).expect(200);await refund(f.id,'SUCCEEDED',1,{...proof,transactionReference:'another'}).expect(409);
  const s=await state(f.id);expect(s.refund!.status).toBe('SUCCEEDED');await expect(sql.query('UPDATE order_refunds SET status=\'PENDING\' WHERE order_id::text=$1',[f.id])).rejects.toBeTruthy();
  const customer=trackingBody(await tracking(f.user,f.id).expect(200));expect(customer.refund).not.toHaveProperty('evidenceReference');expect(customer.events.some(e=>e.actorRole==='ADMIN')).toBe(true);
  await expect(sql.query('DELETE FROM order_tracking_events WHERE order_id::text=$1',[f.id])).rejects.toBeTruthy();
 });
 test('refund failure remains failure; retry reopens tracking without altering payment or inventory',async()=>{
  const f=await fixture();await cancel(f).expect(200);await refund(f.id,'APPROVE',0).expect(200);await refund(f.id,'FAILED',1,{note:'External transfer rejected'}).expect(200);
  expect(trackingBody(await tracking(f.user,f.id).expect(200)).refund!.status).toBe('FAILED');const balances=await db.ingredient.findMany({orderBy:{id:'asc'}});
  await refund(f.id,'RETRY',2).expect(200);expect(trackingBody(await tracking(f.user,f.id).expect(200)).refund!.status).toBe('PENDING');
  expect(await db.ingredient.findMany({orderBy:{id:'asc'}})).toEqual(balances);expect((await db.payment.findFirstOrThrow({where:{orderId:f.id}})).status).toBe('SUCCEEDED');
 });
 test('exception after preparation retains consumed materials and actual Order progress',async()=>{
  const f=await fixture(121);await transition(f.id,'PREPARING').then(r=>expect(r.status).toBe(200));const materials=await db.ingredient.findMany({orderBy:{id:'asc'}});
  const sent=await support(f);expect(sent.status).toBe(200);await review(f.id,(sent.body as {id:string}).id).then(r=>expect(r.status).toBe(200));
  const s=await state(f.id);expect(s.order.status).toBe('PREPARING');expect(s.refund!.status).toBe('PENDING');expect(s.reservations.every(r=>r.state==='CONSUMED')).toBe(true);expect(await db.ingredient.findMany({orderBy:{id:'asc'}})).toEqual(materials);
 });
 test('zero-total cancellation has no cash-refund request',async()=>{
  const f=await fixture(30,true);await cancel(f).expect(200);expect(trackingBody(await tracking(f.user,f.id).expect(200)).refund).toBeNull();
 });
 test('Staff keeps reading a paid order cancelled by Customer, but cannot read an unpaid cancellation',async()=>{
  const f=await fixture();await cancel(f).expect(200);
  await request(app.getHttpServer()).get(`/operator/orders/${f.id}`).set('Authorization',auth(staff)).expect(200);
  await db.order.update({where:{id:f.id},data:{paidAt:null}});
  await request(app.getHttpServer()).get(`/operator/orders/${f.id}`).set('Authorization',auth(staff)).expect(404);
 });
 test('refund insert failure rolls back cancellation, stock, points and status events atomically',async()=>{
  const f=await fixture(),before=await state(f.id),owner=await db.user.findUniqueOrThrow({where:{id:f.user}}),materials=await db.ingredient.findMany({orderBy:{id:'asc'}});
  await sql.query("CREATE FUNCTION aftercare_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback fault'; END $$; CREATE TRIGGER aftercare_fault BEFORE INSERT ON order_refunds FOR EACH ROW EXECUTE FUNCTION aftercare_fault()");
  try{await cancel(f).expect(503);expect(await state(f.id)).toEqual(before);expect(await db.user.findUniqueOrThrow({where:{id:f.user}})).toEqual(owner);expect(await db.ingredient.findMany({orderBy:{id:'asc'}})).toEqual(materials);}
  finally{await sql.query('DROP TRIGGER aftercare_fault ON order_refunds; DROP FUNCTION aftercare_fault()');}
  await cancel(f).expect(200);
 });
 test('ownership, roles, strict payload and no-store contracts are enforced',async()=>{
  const f=await fixture();await request(app.getHttpServer()).get(`/orders/${f.id}/tracking`).expect(401);await tracking(other,f.id).expect(404);await tracking(staff,f.id).expect(200);
  await post(staff,`/admin/orders/${f.id}/refund`,{action:'APPROVE',expectedVersion:0}).expect(403);await post(f.user,`/orders/${f.id}/cancel`,{serverNow:'fake'}).expect(400);
  const response=await tracking(f.user,f.id).expect(200);expect(response.headers['cache-control']).toContain('no-store');expect(response.headers.vary).toMatch(/Authorization/);expect(response.body).not.toHaveProperty('userId');
  expect(trackingBody(response).events.map(e=>e.status)).toEqual(['PENDING','PAID']);
 });
});
