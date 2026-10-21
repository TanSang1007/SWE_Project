import { Transform } from 'class-transformer';
import { IsIn, IsUUID } from 'class-validator';
export class PaymentDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsUUID() orderId!: string;
  @IsIn(['WALLET', 'CARD']) method!: 'WALLET' | 'CARD';
}
export class PaymentEmptyDto {}
