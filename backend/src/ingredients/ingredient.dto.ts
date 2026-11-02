import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
export class IngredientEmptyDto {}
export class IngredientPageDto { @IsOptional() @IsUUID() cursor?: string; }
export class IngredientParamsDto { @IsUUID() id!: string; }
export class IngredientCreateDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsIn(['KG', 'G', 'L', 'ML', 'PIECE','EGG']) unit!: 'KG' | 'G' | 'L' | 'ML' | 'PIECE' | 'EGG';
  // Kept optional for exact replay of earlier I01 requests; new values are fixed by unit.
  @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/) lowStockThreshold?: string;
}
export class ReceiptLineDto {
  @IsUUID() ingredientId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/) quantity!: string;
}
export class ReceiptCreateDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto) lines!: ReceiptLineDto[];
}
export class CountLineDto {
  @IsUUID() ingredientId!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsString() @Matches(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/) actualQuantity!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class CountCreateDto {
  @IsOptional() @IsUUID() recountOfId?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CountLineDto) lines!: CountLineDto[];
}
export class IngredientVersionDto { @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number; }
export class CountReviewDto extends IngredientVersionDto {
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_RECOUNT']) action!: 'APPROVE' | 'REJECT' | 'REQUEST_RECOUNT';
  @IsString() @MaxLength(500) note!: string;
}
