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
}

export interface ProductListDto {
  items: CatalogProductDto[];
  currency: 'VND';
}

export interface ProductDetailDto extends CatalogProductDto {
  sizes: { size: string; extraPrice: string }[];
  toppings: { id: string; name: string; price: string }[];
}
