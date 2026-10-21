import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';

describe('Bootstrap HTTP foundation', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://demo:example@localhost:5432/brewlite';
    process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app); await app.init();
  });
  afterAll(async () => { await app.close(); });
  it('returns liveness without a running database', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });
  it('returns the shared error envelope on an unknown route', async () => {
    const result = await request(app.getHttpServer()).get('/unknown').expect(404);
    expect(result.body).toEqual({ error: {
      code: 'NOT_FOUND', message: 'Cannot GET /unknown', details: [], requestId: expect.any(String) as unknown,
    } });
  });
  it('returns the configured CORS origin', async () => {
    const result = await request(app.getHttpServer()).get('/health').set('Origin', 'http://localhost:3000');
    expect(result.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
  it('rejects oversized JSON with the payload error contract', async () => {
    const result = await request(app.getHttpServer()).get('/health')
      .send({ value: 'x'.repeat(65 * 1024) }).expect(413);
    expect(result.body).toEqual({ error: {
      code: 'PAYLOAD_TOO_LARGE', message: 'Request payload too large', details: [], requestId: expect.any(String) as unknown,
    } });
  });
  it('rejects malformed JSON without exposing parser internals', async () => {
    const result = await request(app.getHttpServer()).get('/health')
      .set('Content-Type', 'application/json').send('{invalid').expect(400);
    expect(result.body).toEqual({ error: {
      code: 'VALIDATION_ERROR', message: 'Invalid JSON request body', details: [], requestId: expect.any(String) as unknown,
    } });
  });
});
