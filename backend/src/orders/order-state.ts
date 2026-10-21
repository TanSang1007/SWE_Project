import { ConflictException } from '@nestjs/common';
import type { OrderStatus } from '../generated/prisma/client';

// PDF §9.1 / Docs/API_DESIGN.md §9. Command idempotency is not a self-edge.
const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['PREPARING', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING', 'CANCELLED'],
  PREPARING: ['READY'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!transitions[from]?.includes(to)) {
    throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Order does not allow this transition' });
  }
}
