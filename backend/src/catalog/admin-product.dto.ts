import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const moneyPattern = /^(0|[1-9]\d{0,11})$/;
// Assets are managed outside A04. Forbid scheme, encoded traversal, backslash,
// query/fragment, empty/dot path segments and parent traversal.
const imagePattern = /^\/images\/(?!.*\.\.)(?:(?!\.(?:\/|$))[A-Za-z0-9_.-]+\/)*(?!\.$)[A-Za-z0-9_.-]+$/;
export class ProductSizeCreateDto {
  @IsIn(['S', 'M', 'L']) size!: string;
  @IsString() @Matches(moneyPattern) extraPrice!: string;
}
export class ProductCreateDto {
  @Transform(trim) @IsString() @Length(1, 120) name!: string;
  @IsString() @Matches(moneyPattern) price!: string;
  @IsString() @MaxLength(512) @Matches(imagePattern) imageUrl!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique((entry: ProductSizeCreateDto) => entry?.size)
  @ValidateNested({ each: true }) @Type(() => ProductSizeCreateDto) sizes!: ProductSizeCreateDto[];
  @Transform(({ value }: { value: unknown }) => Array.isArray(value) ? value.map((id: unknown) => typeof id === 'string' ? id.toLowerCase() : id) : value)
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true }) toppingIds!: string[];
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
