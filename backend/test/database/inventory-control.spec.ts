import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/database/prisma.service';
import { utcConnectionString } from '../../src/database/pg-connection';
import { IngredientService } from '../../src/ingredients/ingredient.service';
import { changeOrderIngredients, reserveOrderIngredients } from '../../src/ingredients/order-ingredients';
import { inventoryDayStart } from '../../src/ingredients/inventory-control';

const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString||!['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname)||!/_test$/.test(new URL(connectionString).pathname))throw Error('Explicit local test database required');
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
describe.each(['uuid','text'])('inventory control with %s identities',storage=>{
 const schema='inventory_control_'+randomUUID().replaceAll('-',''),sql=new Client({connectionString});
 const db=Object.assign(new PrismaClient({adapter:new PrismaPg({connectionString:utcConnectionString(connectionString,`-c search_path=${schema}`)},{schema})}),{transactionOptions:{maxWait:2000,timeout:5000}});
 const service=new IngredientService(db as PrismaService),admin=storage==='text'?'301':randomUUID(),staff=storage==='text'?'302':randomUUID(),otherStaff=storage==='text'?'303':randomUUID();
 const stock=(id:string)=>db.ingredient.findUniqueOrThrow({where:{id}});
 async function receipt(id:string,amount:string){const r=await service.createReceipt(admin,randomUUID(),{lines:[{ingredientId:id,quantity:amount}]});return service.confirmReceipt(admin,r.id,0);}
 async function material(amount='10',recipe=false){const {id}=await service.createIngredient(admin,randomUUID(),{name:'Test '+randomUUID()+(recipe?' (công thức)':''),unit:'L'});if(amount!=='0')await receipt(id,amount);return id;}
 async function count(id:string,actual:string,draft=false){return service.createCount(staff,randomUUID(),{saveAsDraft:draft,lines:[{ingredientId:id,expectedVersion:(await stock(id)).version,actualQuantity:actual}]});}
 async function approve(doc:{id:string;version:number}){return service.reviewCount(admin,doc.id,{action:'APPROVE',expectedVersion:doc.version,note:''});}
 async function order(){return db.order.create({data:{userId:staff,orderCode:randomUUID(),status:'PENDING',subtotal:'0',total:'0'}});}
 async function reserve(id:string,amount:string){const ingredient=await stock(id),o=await order();await db.$transaction(tx=>reserveOrderIngredients(tx,o.id,[{name:ingredient.name.replace(/ \(công thức\)$/,''),unit:'L',quantity:amount}],staff));return o.id;}
 beforeAll(async()=>{
  await sql.connect();await sql.query(`CREATE SCHEMA ${quote(schema)}`);await sql.query(`SET search_path TO ${quote(schema)}`);
  const directory=resolve(__dirname,'../../prisma/migrations');for(const name of readdirSync(directory).filter(n=>/^\d+_/.test(n)).sort())await sql.query(readFileSync(resolve(directory,name,'migration.sql'),'utf8'));
  if(storage==='text'){
   const constraints=(await sql.query<{table:string;name:string;definition:string}>(`SELECT c.conrelid::regclass::text AS "table",c.conname AS name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype IN ('f','c')`,[schema])).rows;
   for(const row of constraints)await sql.query(`ALTER TABLE ${row.table} DROP CONSTRAINT ${quote(row.name)}`);
   for(const column of (await sql.query<{table_name:string;column_name:string}>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND udt_name='uuid'",[schema])).rows)await sql.query(`ALTER TABLE ${quote(column.table_name)} ALTER COLUMN ${quote(column.column_name)} TYPE text USING ${quote(column.column_name)}::text`);
   for(const row of constraints)await sql.query(`ALTER TABLE ${row.table} ADD CONSTRAINT ${quote(row.name)} ${row.definition}`);
  }
  for(const [id,role]of [[admin,'ADMIN'],[staff,'STAFF'],[otherStaff,'STAFF']] as const)await db.user.create({data:{id,role,email:id+'@example.invalid',passwordHash:'synthetic-test-only'}});
 });
 afterAll(async()=>{await db.$disconnect();await sql.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);await sql.end();});

 test('draft is private, non-mutating and cannot be reviewed before owner submission',async()=>{
  const id=await material(),doc=await count(id,'9',true);expect(doc.status).toBe('DRAFT');expect((await stock(id)).quantity.toFixed(3)).toBe('10.000');
  expect((await service.counts(admin,'ADMIN')).items.some(c=>c.id===doc.id)).toBe(false);expect((await service.summary(staff,'STAFF')).pendingCounts).toBe(0);
  await expect(approve(doc)).rejects.toMatchObject({response:{code:'INVALID_DOCUMENT_STATE'}});
  await expect(service.submitCount(otherStaff,doc.id,0)).rejects.toMatchObject({response:{code:'DOCUMENT_NOT_FOUND'}});
  const submitted=await service.submitCount(staff,doc.id,0);expect(submitted.status).toBe('SUBMITTED');expect(await service.submitCount(staff,doc.id,0)).toEqual(submitted);
  const result=await approve(submitted);expect(result.status).toBe('APPROVED');expect((await stock(id)).quantity.toFixed(3)).toBe('9.000');expect(await approve(submitted)).toEqual(result);
  expect(await db.ingredientMovement.count({where:{countLine:{countId:doc.id}}})).toBe(1);
 });
 test('receipt after the count remains intact and only the recorded discrepancy is adjusted',async()=>{
  const id=await material(),doc=await count(id,'8');await receipt(id,'20');const result=await approve(doc);
  expect((await stock(id)).quantity.toFixed(3)).toBe('28.000');expect(result.lines[0].movement).toMatchObject({beforeQuantity:'30.000',afterQuantity:'28.000',delta:'-2.000'});
 });
 test('consumption, holds and release after counting reconcile without losing stock or double consumption',async()=>{
  const id=await material('10',true),doc=await count(id,'9');const first=await reserve(id,'2'),second=await reserve(id,'3');
  await db.$transaction(tx=>changeOrderIngredients(tx,first,'CONSUME',staff));await db.$transaction(tx=>changeOrderIngredients(tx,second,'RELEASE',staff));
  await approve(doc);expect((await stock(id)).quantity.toFixed(3)).toBe('7.000');expect((await stock(id)).reservedQuantity.toFixed(3)).toBe('0.000');
  await db.$transaction(tx=>changeOrderIngredients(tx,first,'CONSUME',staff));expect((await stock(id)).quantity.toFixed(3)).toBe('7.000');
 });
 test('same physical discrepancy in overlapping counts cannot be applied twice',async()=>{
  const id=await material(),a=await count(id,'8'),b=await count(id,'8');await approve(a);await expect(approve(b)).rejects.toMatchObject({response:{code:'INVENTORY_CHANGED'}});
  expect((await stock(id)).quantity.toFixed(3)).toBe('8.000');
 });
 test('unrecorded balance changes are rejected rather than overwriting them',async()=>{
  const id=await material(),doc=await count(id,'8');await db.ingredient.update({where:{id},data:{quantity:'11',version:{increment:1}}});
  await expect(approve(doc)).rejects.toMatchObject({response:{code:'INVENTORY_CHANGED'}});expect((await stock(id)).quantity.toFixed(3)).toBe('11.000');
 });
 test('threshold snapshots and daily consumption remain immutable after policy changes',async()=>{
  const id=await material('10',true);
  await service.configureControl(admin,id,{expectedVersion:(await stock(id)).version,variancePercentThreshold:'5',varianceAbsoluteThreshold:'0.1'});
  const o=await reserve(id,'2');await db.$transaction(tx=>changeOrderIngredients(tx,o,'CONSUME',staff));const current=await stock(id);
  const actual=current.quantity.minus('0.1').toFixed(3),doc=await count(id,actual);
  expect(doc.lines[0]).toMatchObject({theoreticalConsumption:'2.000',variancePercent:'5.000',controlStatus:'WITHIN_THRESHOLD',variancePercentThreshold:'5.000'});
  expect(doc.periodStart).toBe(inventoryDayStart(new Date(doc.createdAt)).toISOString());
  await service.configureControl(admin,id,{expectedVersion:(await stock(id)).version,variancePercentThreshold:'1',varianceAbsoluteThreshold:'0'});
  const reread=(await service.counts(staff,'STAFF')).items.find(c=>c.id===doc.id)!;expect(reread.lines[0].variancePercentThreshold).toBe('5.000');expect(reread.lines[0].controlStatus).toBe('WITHIN_THRESHOLD');
  await approve(doc);
 });
 test('zero consumption uses absolute threshold and absent settings never imply approval',async()=>{
  const id=await material();let doc=await count(id,'9.9');expect(doc.lines[0]).toMatchObject({theoreticalConsumption:'0.000',variancePercent:null,controlStatus:'UNCONFIGURED'});
  await service.reviewCount(admin,doc.id,{action:'REJECT',expectedVersion:0,note:'configure first'});
  await service.configureControl(admin,id,{expectedVersion:(await stock(id)).version,variancePercentThreshold:'3',varianceAbsoluteThreshold:'0.1'});
  doc=await count(id,'9.9');expect(doc.lines[0]).toMatchObject({variancePercent:null,controlStatus:'WITHIN_THRESHOLD'});expect((await stock(id)).quantity.toFixed(3)).toBe('10.000');
 });
 test('recount uses a rejected document and preserves its original snapshot',async()=>{
  const id=await material(),doc=await count(id,'8');const rejected=await service.reviewCount(admin,doc.id,{action:'REQUEST_RECOUNT',expectedVersion:0,note:'recheck measurement'});
  expect(rejected).toMatchObject({status:'REJECTED',recountRequested:true});expect((await stock(id)).quantity.toFixed(3)).toBe('10.000');
  const next=await service.createCount(staff,randomUUID(),{recountOfId:doc.id,lines:[{ingredientId:id,expectedVersion:(await stock(id)).version,actualQuantity:'9'}]});
  await approve(next);expect((await service.counts(staff,'STAFF')).items.find(c=>c.id===doc.id)?.lines[0].actualQuantity).toBe('8.000');
 });
 test('configuration preserves exact replay and rejects stale changed settings',async()=>{
  const id=await material(),version=(await stock(id)).version,input={expectedVersion:version,variancePercentThreshold:'3',varianceAbsoluteThreshold:'0.2'};
  const configured=await service.configureControl(admin,id,input);expect(await service.configureControl(admin,id,input)).toEqual(configured);
  await expect(service.configureControl(admin,id,{...input,variancePercentThreshold:'4'})).rejects.toMatchObject({response:{code:'INVENTORY_CHANGED'}});
 });
 test('ice, water and supplies cannot enter new variance counts or control settings',async()=>{
  for(const [name,unit]of [['Đá viên','KG'],['Nước lọc','L'],['Cup '+randomUUID(),'PIECE']] as const){
   const {id}=await service.createIngredient(admin,randomUUID(),{name,unit});
   await expect(count(id,'0')).rejects.toMatchObject({response:{code:'INVENTORY_COUNT_NOT_SUPPORTED'}});
   await expect(service.configureControl(admin,id,{expectedVersion:0,varianceAbsoluteThreshold:'0'})).rejects.toMatchObject({response:{code:'INVENTORY_COUNT_NOT_SUPPORTED'}});
   if(name==='Nước lọc')await expect(service.createReceipt(admin,randomUUID(),{lines:[{ingredientId:id,quantity:'1'}]})).rejects.toMatchObject({response:{code:'INGREDIENT_NOT_RECEIVABLE'}});
  }
 });
 test('legacy counts without a journal snapshot retain version safety',async()=>{
  const id=await material(),current=await stock(id),doc=await db.ingredientCount.create({data:{createdById:staff,requestKey:randomUUID(),requestHash:'0'.repeat(64),lines:{create:{ingredientId:id,systemQuantity:'10',actualQuantity:'8',ingredientVersion:current.version}}}});
  await receipt(id,'2');await expect(approve(doc)).rejects.toMatchObject({response:{code:'INVENTORY_CHANGED'}});
 });
 test('an intervening reservation cannot be overwritten; after release the same discrepancy can be reviewed',async()=>{
  const id=await material('10',true),doc=await count(id,'2'),o=await reserve(id,'3');
  await expect(approve(doc)).rejects.toMatchObject({response:{code:'INVENTORY_CHANGED'}});
  expect((await stock(id)).quantity.toFixed(3)).toBe('10.000');expect((await stock(id)).reservedQuantity.toFixed(3)).toBe('3.000');
  await db.$transaction(tx=>changeOrderIngredients(tx,o,'RELEASE',staff));await approve(doc);expect((await stock(id)).quantity.toFixed(3)).toBe('2.000');
 });
 test('concurrent approvals adjust a document once and can recover by replay',async()=>{
  const id=await material(),doc=await count(id,'8');await Promise.allSettled([approve(doc),approve(doc)]);await approve(doc);
  expect((await stock(id)).quantity.toFixed(3)).toBe('8.000');expect(await db.ingredientMovement.count({where:{countLine:{countId:doc.id}}})).toBe(1);
 });
 test('water catalog removal preserves its legacy row while listing 18 active items',async()=>{
  const old=await service.createIngredient(admin,randomUUID(),{name:'Nước lọc (công thức)',unit:'L'}),before=await stock(old.id);
  await service.initializeCatalog(admin);const items=(await service.ingredients()).items;
  expect(items.filter(item=>item.isListed)).toHaveLength(18);expect(items.find(item=>item.id===old.id)?.isListed).toBe(false);expect(await stock(old.id)).toEqual(before);
 });
 test('approval and its journal roll back together after an insert failure',async()=>{
  const id=await material(),doc=await count(id,'8'),before=await stock(id);
  await sql.query(`CREATE FUNCTION count_journal_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.count_line_id IS NOT NULL THEN RAISE EXCEPTION 'isolated count fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER count_journal_fault BEFORE INSERT ON ingredient_movements FOR EACH ROW EXECUTE FUNCTION count_journal_fault()`);
  try{await expect(approve(doc)).rejects.toMatchObject({status:503});expect(await stock(id)).toEqual(before);expect((await db.ingredientCount.findUniqueOrThrow({where:{id:doc.id}})).status).toBe('SUBMITTED');}
  finally{await sql.query('DROP TRIGGER count_journal_fault ON ingredient_movements; DROP FUNCTION count_journal_fault()');}
  await approve(doc);expect((await stock(id)).quantity.toFixed(3)).toBe('8.000');
 });
});
