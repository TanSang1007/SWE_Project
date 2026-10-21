import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { ProductVersionDto } from './admin-product.dto';
import { ProductParamsDto } from './dto/catalog.dto';
const money = /^(0|[1-9]\d{0,11})$/;
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class SizeParamsDto extends ProductParamsDto { @IsIn(['S', 'M', 'L']) size!: string; }
export class AssociationParamsDto extends ProductParamsDto { @IsUUID() toppingId!: string; }
export class AdminSizeCreateDto extends ProductVersionDto {
  @IsIn(['S', 'M', 'L']) size!: string;
  @IsString() @Matches(money) extraPrice!: string;
}
export class AdminSizeUpdateDto extends ProductVersionDto {
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @Matches(money) extraPrice?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsBoolean() isActive?: boolean;
}
export class ToppingCreateDto {
  @Transform(trim) @IsString() @Length(1, 120) name!: string;
  @IsString() @Matches(money) price!: string;
}
export class ToppingUpdateDto extends ProductVersionDto {
  @ValidateIf((_object, value: unknown) => value !== undefined) @Transform(trim) @IsString() @Length(1, 120) name?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @Matches(money) price?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsBoolean() isActive?: boolean;
}
export class AssociationCreateDto extends ProductVersionDto { @IsUUID() toppingId!: string; }
