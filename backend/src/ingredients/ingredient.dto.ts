<<<<<<< HEAD
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
=======
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const trimLower = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value;

>>>>>>> origin/main
export class IngredientEmptyDto {}
export class IngredientPageDto { @IsOptional() @Transform(trimLower) @IsString() @Matches(idPattern) cursor?: string; }
export class IngredientParamsDto { @Transform(trimLower) @IsString() @Matches(idPattern) id!: string; }
export class IngredientCreateDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsIn(['KG', 'G', 'L', 'ML', 'PIECE','EGG','BOTTLE','BAG']) unit!: 'KG' | 'G' | 'L' | 'ML' | 'PIECE' | 'EGG' | 'BOTTLE' | 'BAG';
  // Kept optional for exact replay of earlier I01 requests; new values are fixed by unit.
  @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/) lowStockThreshold?: string;
}
export class ReceiptLineDto {
  @Transform(trimLower) @IsString() @Matches(idPattern) ingredientId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/) quantity!: string;
}
export class ReceiptCreateDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto) lines!: ReceiptLineDto[];
}
export class CountLineDto {
  @Transform(trimLower) @IsString() @Matches(idPattern) ingredientId!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsString() @Matches(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/) actualQuantity!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class CountCreateDto {
<<<<<<< HEAD
  @IsOptional() @IsBoolean() saveAsDraft?: boolean;
  @IsOptional() @IsUUID() recountOfId?: string;
=======
  @IsOptional() @Transform(trimLower) @IsString() @Matches(idPattern) recountOfId?: string;
>>>>>>> origin/main
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CountLineDto) lines!: CountLineDto[];
}
export class IngredientVersionDto { @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number; }
export class IngredientControlDto extends IngredientVersionDto {
  @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,3})(\.\d{1,3})?$/) variancePercentThreshold?: string | null;
  @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/) varianceAbsoluteThreshold?: string | null;
}
export class CountReviewDto extends IngredientVersionDto {
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_RECOUNT']) action!: 'APPROVE' | 'REJECT' | 'REQUEST_RECOUNT';
  @IsString() @MaxLength(500) note!: string;
}
