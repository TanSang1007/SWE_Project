import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const moneyPattern = /^(0|[1-9]\d{0,11})$/;
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
// Assets are managed outside A04. Forbid scheme, encoded traversal, backslash,
// query/fragment, empty/dot path segments and parent traversal.
const imagePattern = /^\/images\/(?!.*\.\.)(?:(?!\.(?:\/|$))[A-Za-z0-9_.-]+\/)*(?!\.$)[A-Za-z0-9_.-]+$/;
// I07: whole grams/ml preserve the warehouse's 0.001 kg/litre precision.
export class ProductRecipeLineDto {
  @IsString() @Matches(idPattern) ingredientId!: string;
  @IsIn(['g', 'ml']) unit!: 'g' | 'ml';
  @IsString() @Matches(/^[1-9]\d{0,8}$/) amount!: string;
}
export class ProductSizeCreateDto {
  @IsIn(['S', 'M', 'L']) size!: string;
  @IsString() @Matches(moneyPattern) extraPrice!: string;
  // Optional for existing API clients; when supplied, every selected size needs a recipe.
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ArrayUnique((line: ProductRecipeLineDto) => line?.ingredientId)
  @ValidateNested({ each: true }) @Type(() => ProductRecipeLineDto) recipe?: ProductRecipeLineDto[];
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString() @Matches(/^(0|[1-9]\d{0,8})$/) waterMl?: string;
}
export class ProductCreateDto {
  @Transform(trim) @IsString() @Length(1, 120) name!: string;
  @IsString() @Matches(moneyPattern) price!: string;
  @IsString() @MaxLength(512) @Matches(imagePattern) imageUrl!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique((entry: ProductSizeCreateDto) => entry?.size)
  @ValidateNested({ each: true }) @Type(() => ProductSizeCreateDto) sizes!: ProductSizeCreateDto[];
  @Transform(({ value }: { value: unknown }) => Array.isArray(value) ? value.map((id: unknown) => typeof id === 'string' ? id.trim().toLowerCase() : id) : value)
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) @Matches(idPattern, { each: true }) toppingIds!: string[];
}
export class ProductVersionDto {
  @IsInt() @Min(0) @Max(2147483647) expectedVersion!: number;
}
export class ProductUpdateDto extends ProductVersionDto {
  @ValidateIf((_object, value: unknown) => value !== undefined) @Transform(trim) @IsString() @Length(1, 120) name?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @Matches(moneyPattern) price?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @MaxLength(512) @Matches(imagePattern) imageUrl?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsBoolean() isActive?: boolean;
}
