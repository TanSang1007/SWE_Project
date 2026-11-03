import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { CatalogProductDto, ProductDetailDto, ProductListDto } from './dto/catalog.dto';

const productSelect = {
  id: true, name: true, price: true, imageUrl: true, stock: true, isActive: true,
  sizes: { where: { isActive: true }, select: { size: true } },
} satisfies Prisma.ProductSelect;
type CatalogRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(): Promise<ProductListDto> {
    const products = await this.prisma.product.findMany({ where: { isActive: true }, select: productSelect, orderBy: { id: 'asc' } });
    return { items: products.map(toProductDto), currency: 'VND' };
  }

  async getProduct(id: string): Promise<ProductDetailDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: {
        ...productSelect,
        sizes: { where: { isActive: true }, select: { size: true, extraPrice: true } },
        toppings: {
          where: { topping: { isActive: true } },
          orderBy: { toppingId: 'asc' },
          select: { topping: { select: { id: true, name: true, price: true } } },
        },
      },
    });
    // Nếu sản phẩm không tồn tại hoặc đã ngừng bán (isActive = false) -> ném 404
    if (!product || !product.isActive) throw new NotFoundException('Product not found');
    const sizeOrder = ['S', 'M', 'L'];
    return {
      ...toProductDto(product),
      sizes: product.sizes.sort((a, b) => sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size))
        .map(({ size, extraPrice }) => ({ size, extraPrice: extraPrice.toFixed(0) })),
      toppings: product.toppings.map(({ topping }) => ({
        id: topping.id, name: topping.name, price: topping.price.toFixed(0),
      })),
    };
  }
}

function toProductDto(product: CatalogRow): CatalogProductDto {
  return {
    id: product.id,
    name: product.name,
    price: product.price.toFixed(0),
    imageUrl: product.imageUrl,
    // Khả dụng: Đang kinh doanh (isActive), còn hàng (stock > 0) và có ít nhất 1 size hợp lệ
    available: product.isActive && product.stock > 0 && product.sizes.some(s => ['S', 'M', 'L'].includes(s.size)),
  };
}

