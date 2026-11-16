import { Test } from '@nestjs/testing';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { IngredientController } from '../src/ingredients/ingredient.controller';
import { IngredientService } from '../src/ingredients/ingredient.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { configureApp } from '../src/common/configure-app';
import { ConfigService } from '@nestjs/config';

let app:NestExpressApplication;
const id=randomUUID(),actor=randomUUID(),service={configureControl:jest.fn().mockResolvedValue({id,version:1}),submitCount:jest.fn().mockResolvedValue({id,status:'SUBMITTED'}),createCount:jest.fn().mockResolvedValue({id,status:'DRAFT'})};
beforeAll(async()=>{
 const module=await Test.createTestingModule({controllers:[IngredientController],providers:[{provide:IngredientService,useValue:service},{provide:ConfigService,useValue:new ConfigService({FRONTEND_ORIGIN:'http://localhost:3000'})}]})
  .overrideGuard(JwtAuthGuard).useValue({canActivate(context:ExecutionContext){const req=context.switchToHttp().getRequest<{headers:Record<string,string>;user?:object}>();const role=req.headers['x-test-role'];if(!role)throw new UnauthorizedException();req.user={id:actor,role};return true;}}).compile();
 app=module.createNestApplication<NestExpressApplication>({bodyParser:false});configureApp(app);await app.init();
});
afterAll(async()=>{await app.close();});
afterEach(()=>{jest.clearAllMocks();});
test('Admin may configure controls; Staff/Customer/guest cannot',async()=>{
 const path=`/ingredient-inventory/ingredients/${id}/control`,body={expectedVersion:0,variancePercentThreshold:'3',varianceAbsoluteThreshold:'0.1'};
 await request(app.getHttpServer()).post(path).set('x-test-role','ADMIN').send(body).expect(200);
 expect(service.configureControl).toHaveBeenCalledWith(actor,id,body);
 for(const role of ['STAFF','CUSTOMER'])await request(app.getHttpServer()).post(path).set('x-test-role',role).send(body).expect(403);
 await request(app.getHttpServer()).post(path).send(body).expect(401);
});
test.each([{consumptionWindowDays:7},{bufferDays:3},{variancePercentThreshold:'-1'},{varianceAbsoluteThreshold:'1.0001'},{expectedVersion:-1},{quantity:'999'},{actorId:actor}])('invalid, removed or forged policy input %p is rejected before service',async extra=>{
 await request(app.getHttpServer()).post(`/ingredient-inventory/ingredients/${id}/control`).set('x-test-role','ADMIN').send({expectedVersion:0,...extra}).expect(400);expect(service.configureControl).not.toHaveBeenCalled();
});
test('Staff may save and submit a draft but cannot set snapshot or review state',async()=>{
 const body={saveAsDraft:true,lines:[{ingredientId:id,expectedVersion:0,actualQuantity:'1.000'}]};
 const response=await request(app.getHttpServer()).post('/ingredient-inventory/counts').set('x-test-role','STAFF').set('Idempotency-Key',randomUUID()).send(body).expect(201);expect(response.headers['cache-control']).toContain('no-store');
 await request(app.getHttpServer()).post(`/ingredient-inventory/counts/${id}/submit`).set('x-test-role','STAFF').send({expectedVersion:0}).expect(200);expect(service.submitCount).toHaveBeenCalledWith(actor,id,0);
 for(const extra of [{status:'APPROVED'},{movementSequence:'1'},{periodStart:'2026-11-13'},{saveAsDraft:'true'}])await request(app.getHttpServer()).post('/ingredient-inventory/counts').set('x-test-role','STAFF').send({...body,...extra}).expect(400);
 for(const role of ['ADMIN','CUSTOMER'])await request(app.getHttpServer()).post(`/ingredient-inventory/counts/${id}/submit`).set('x-test-role',role).send({expectedVersion:0}).expect(403);
});
