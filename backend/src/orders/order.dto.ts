import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsObject, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
export class OrderItemDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsUUID() productId!: string;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsIn(['S', 'M', 'L']) size!: string;
  @IsInt() @Min(1) @Max(99) qty!: number;
  @Transform(({ value }: { value: unknown }) => Array.isArray(value) ? value.map((id: unknown) => typeof id === 'string' ? id.trim().toLowerCase() : id) : value)
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID(undefined, { each: true }) toppingIds!: string[];
}
export class CreateOrderDto {
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) redeemedPoints?: number;
  // The 50-configuration limit belongs to normalizeItems, after duplicates merge.
  @IsArray() @ArrayMinSize(1) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => OrderItemDto) items!: OrderItemDto[];
  @ValidateIf((_object, value: unknown) => value !== undefined) @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @MinLength(1) @MaxLength(32) promotionCode?: string;
}
export class OrderParamsDto { @IsUUID() id!: string; }
export class OrderEmptyDto {}
