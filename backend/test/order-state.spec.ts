import { HttpException } from '@nestjs/common';
import { assertTransition } from '../src/orders/order-state';
import type { OrderStatus } from '../src/generated/prisma/client';

// Cac trang thai don hang duoc kiem tra trong bo test.
const statuses: OrderStatus[] = ['PENDING', 'PAID', 'PAYMENT_FAILED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];

// Cac cap trang thai hop le theo so do chuyen trang thai.
const edges = new Set(['PENDING:PAID', 'PENDING:PAYMENT_FAILED', 'PAYMENT_FAILED:PENDING',
  'PENDING:CANCELLED',  'PAYMENT_FAILED:CANCELLED', 'PAID:CANCELLED',
  'PAID:PREPARING', 'PREPARING:READY', 'READY:COMPLETED']);

// Kiem tra tat ca cac cap trang thai co duoc chap nhan dung quy tac hay khong.
test.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))('%s -> %s follows PDF graph', (from, to) => {
  if (edges.has(`${from}:${to}`)) {
    expect(() => assertTransition(from, to)).not.toThrow();
  } else {
    try {
      assertTransition(from, to);
      throw new Error('Invalid edge accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'INVALID_ORDER_STATE' });
    }
  }
});
