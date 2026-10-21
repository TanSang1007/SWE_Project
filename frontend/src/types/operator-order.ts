import type { OrderDetail, OrderHistoryItem } from './order';
export interface OrderRevision { version: number; updatedAt: string; }
export type OperatorOrderSummary = OrderHistoryItem & OrderRevision;
export type OperatorOrderDetail = OrderDetail & OrderRevision;
