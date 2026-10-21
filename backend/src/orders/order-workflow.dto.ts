import { IsIn, IsInt, Max, Min } from 'class-validator';
export class PaidCancelDto {
  @IsInt() @Min(0) @Max(2147483647)
  expectedVersion!: number;
}
export class OrderTransitionDto extends PaidCancelDto {
  @IsIn(['PREPARING', 'READY', 'COMPLETED'])
  targetStatus!: 'PREPARING' | 'READY' | 'COMPLETED';
}
