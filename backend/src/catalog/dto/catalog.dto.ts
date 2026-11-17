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

// No query options are supported. Global whitelist rejects extras.
export class CatalogQueryDto {}

export interface CatalogProductDto {
  id: string;
  name: string;
  price: string;
  imageUrl: string;
  // Requires an active size with enough unreserved ingredients for one serving.
  available: boolean;
  sizeAvailability?: { size: string; maxQuantity: number; available: boolean }[];
}

export interface ProductListDto {
  items: CatalogProductDto[];
  currency: 'VND';
}

export interface ProductDetailDto extends CatalogProductDto {
  // maxQuantity is computed from the S/M/L recipe; no manual drink balance.
  sizes: { size: string; extraPrice: string; available: boolean; maxQuantity: number }[];
  toppings: { id: string; name: string; price: string; availableSizes: string[] }[];
}
