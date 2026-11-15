import { ConflictException } from '@nestjs/common';
import { Prisma } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import { IngredientService } from '../src/ingredients/ingredient.service';

function serviceFailingWith(error: unknown) {
  const db = { $transaction: jest.fn().mockRejectedValue(error) };
  return new IngredientService(db as unknown as PrismaService);
}
function sqlError(state?: string, adapter = false) {
  return new Prisma.PrismaClientKnownRequestError('Internal database detail', {
    clientVersion: 'test', code: 'P2010',
    meta: adapter ? { driverAdapterError: { cause: { originalCode: state } } } : { code: state },
  });
}

test.each(['42883', '42P01', 'XX000', undefined])('SQL fault %s returns sanitized 503 rather than a false concurrent update', async state => {
  for (const adapter of [false, true]) {
    await expect(serviceFailingWith(sqlError(state, adapter)).initializeCatalog('actor'))
      .rejects.toMatchObject({ status: 503, response: { code: 'SERVICE_UNAVAILABLE' } });
  }
});

test.each(['55P03', '57014', '40P01', '40001'])('recognized SQL contention %s retains the recoverable conflict contract', async state => {
  for (const adapter of [false, true]) {
    await expect(serviceFailingWith(sqlError(state, adapter)).initializeCatalog('actor'))
      .rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENT_UPDATE' } });
  }
});

test.each(['P2002', 'P2028', 'P2034'])('Prisma contention %s retains the existing conflict response', async code => {
  const error = new Prisma.PrismaClientKnownRequestError('Internal database detail', { clientVersion: 'test', code });
  await expect(serviceFailingWith(error).initializeCatalog('actor'))
    .rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENT_UPDATE' } });
});

test('business conflicts pass through unchanged and unexpected errors expose no database details', async () => {
  const conflict = new ConflictException({ code: 'INVENTORY_CHANGED' });
  await expect(serviceFailingWith(conflict).initializeCatalog('actor')).rejects.toBe(conflict);
  try { await serviceFailingWith(Error('private database detail')).initializeCatalog('actor'); }
  catch (error) {
    expect(error).toMatchObject({ status: 503, response: { code: 'SERVICE_UNAVAILABLE' } });
    expect(JSON.stringify(error)).not.toContain('private database detail');
  }
});
