import { ArrayMaxSize, IsArray, IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
export class CartQueryDto {}
export class CartDeleteDto {}
export class CartParamsDto { @IsUUID() id!: string; }
export class CartQuantityDto {
  @IsInt() @Min(1) @Max(99) qty!: number;
}
export class AddCartItemDto extends CartQuantityDto {
  @IsUUID() productId!: string;
  @IsIn(['S', 'M', 'L']) size!: string;
  @IsArray() @ArrayMaxSize(10) @IsUUID(undefined, { each: true }) toppingIds!: string[];
}
