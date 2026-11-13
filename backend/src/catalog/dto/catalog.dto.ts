import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export function normalizeCatalogId(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return /^br\d+$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed.toLowerCase();
}

export class ProductParamsDto {
  @Transform(({ value }: { value: unknown }) => normalizeCatalogId(value))
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  id!: string;
}

// No query options exist in API_DESIGN §3. Global whitelist rejects extras.
export class CatalogQueryDto {}

export interface CatalogProductDto {
  id: string;
  name: string;
  price: string;
  imageUrl: string;
  available: boolean;
}

export interface ProductListDto {
  items: CatalogProductDto[];
  currency: 'VND';
}

export interface ProductDetailDto extends CatalogProductDto {
  sizes: { size: string; extraPrice: string }[];
  toppings: { id: string; name: string; price: string }[];
}
