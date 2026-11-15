import { IsUUID } from 'class-validator';

export class ProductParamsDto {
  @IsUUID()
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
  stockStatus?: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';
  sizeAvailability?: { size: string; maxQuantity: number; stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK' }[];
}

export interface ProductListDto {
  items: CatalogProductDto[];
  currency: 'VND';
}

export interface ProductDetailDto extends CatalogProductDto {
  sizes: { size: string; extraPrice: string; available?: boolean; maxQuantity?: number; stockStatus?: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK' }[];
  toppings: { id: string; name: string; price: string; availableSizes?: string[] }[];
}
