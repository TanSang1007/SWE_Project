import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/database/prisma.service';

describe('Catalog error boundary', () => {
  let app: NestExpressApplication;
  const product = { findMany: jest.fn(), findUnique: jest.fn() };
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://demo:example@localhost:5432/brewlite';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({ product }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app); await app.init();
  });
  beforeEach(() => { jest.clearAllMocks(); });
  afterAll(async () => { await app.close(); });

  it.each(['/products', '/products/11111111-1111-4111-8111-111111111111'])('sanitizes database failure on %s', async (endpoint) => {
    const failure = new Error('Prisma SELECT products; postgresql://demo:example@localhost/database');
    product.findMany.mockRejectedValue(failure); product.findUnique.mockRejectedValue(failure);
    const result = await request(app.getHttpServer()).get(endpoint).expect(500);
    expect(result.body).toEqual({ error: {
      code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error', details: [], requestId: expect.any(String) as unknown,
    } });
    expect(result.text).not.toMatch(/Prisma|SELECT|postgresql|stack/);
  });
  it('rejects invalid UUID before querying the database', async () => {
    await request(app.getHttpServer()).get('/products/not-a-uuid').expect(400);
    expect(product.findUnique).not.toHaveBeenCalled();
  });
});
