import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { normalizeCatalogId } from '../catalog/dto/catalog.dto';

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const trimLower = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CartQueryDto {}
export class CartDeleteDto {}
export class CartParamsDto {
  @Transform(trimLower)
  @IsString()
  @Matches(idPattern)
  id!: string;
}
export class CartQuantityDto {
  @IsInt() @Min(1) @Max(99) qty!: number;
}
export class CartOptionsDto {
  @IsIn(['S', 'M', 'L']) size!: string;
  @Transform(({ value }: { value: unknown }) => Array.isArray(value) ? value.map((id: unknown) => typeof id === 'string' ? id.trim().toLowerCase() : id) : value)
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(idPattern, { each: true }) toppingIds!: string[];
}
export class AddCartItemDto extends CartQuantityDto {
  @Transform(({ value }: { value: unknown }) => normalizeCatalogId(value))
  @IsString()
  @Matches(idPattern)
  productId!: string;
  @IsIn(['S', 'M', 'L']) size!: string;
  @Transform(({ value }: { value: unknown }) => Array.isArray(value) ? value.map((id: unknown) => typeof id === 'string' ? id.trim().toLowerCase() : id) : value)
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(idPattern, { each: true }) toppingIds!: string[];
}
