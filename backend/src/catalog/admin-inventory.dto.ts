import { IsInt, Max, Min, NotEquals } from 'class-validator';
import { ProductVersionDto } from './admin-product.dto';
export class InventoryAdjustmentDto extends ProductVersionDto {
  @IsInt() @Min(-2147483647) @Max(2147483647) @NotEquals(0) delta!: number;
}
