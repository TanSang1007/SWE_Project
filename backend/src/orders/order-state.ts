import { ConflictException } from '@nestjs/common';
import type { OrderStatus } from '../generated/prisma/client';


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
  if ( !transitions[from]?.includes(to) ) {
    throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Khong the chuyen trang thai don hang nay' });
  }
}
