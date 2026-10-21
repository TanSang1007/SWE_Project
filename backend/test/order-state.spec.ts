import { HttpException } from '@nestjs/common';
import { assertTransition } from '../src/orders/order-state';
import type { OrderStatus } from '../src/generated/prisma/client';

const statuses: OrderStatus[] = ['PENDING', 'PAID', 'PAYMENT_FAILED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];
// Independent expected graph transcribed from PDF §9.1, including terminal states.
const edges = new Set(['PENDING:PAID', 'PENDING:PAYMENT_FAILED', 'PAYMENT_FAILED:PENDING',
  'PENDING:CANCELLED', 'PAYMENT_FAILED:CANCELLED', 'PAID:CANCELLED',
  'PAID:PREPARING', 'PREPARING:READY', 'READY:COMPLETED']);
test.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))('%s -> %s follows PDF graph', (from, to) => {
  if (edges.has(`${from}:${to}`)) expect(() => assertTransition(from, to)).not.toThrow();
  else {
    try { assertTransition(from, to); throw new Error('Invalid edge accepted'); }
    catch (error) { expect(error).toBeInstanceOf(HttpException); expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'INVALID_ORDER_STATE' }); }
  }
});
