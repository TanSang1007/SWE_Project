import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { normalizeCatalogId, type CatalogProductDto, type ProductDetailDto, type ProductListDto } from './dto/catalog.dto';
import { configurationIngredientStates, productIngredientStates } from './product-ingredients';

function compareIds(a: string, b: string) {
  const ma = /^BR(\d+)$/i.exec(a);
  const mb = /^BR(\d+)$/i.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  const na = /^\d+$/.test(a) ? Number(a) : Number.POSITIVE_INFINITY;
  const nb = /^\d+$/.test(b) ? Number(b) : Number.POSITIVE_INFINITY;
  return na !== nb ? na - nb : a.localeCompare(b);
}

const productSelect = {
  id: true, name: true, price: true, imageUrl: true, stock: true, isActive: true,
  sizes: { where: { isActive: true }, select: { size: true } },
} satisfies Prisma.ProductSelect;
type CatalogRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(): Promise<ProductListDto> {
    const products = await this.prisma.product.findMany({ where: { isActive: true }, select: productSelect });
    products.sort((a, b) => compareIds(a.id, b.id));
    const states = await productIngredientStates(this.prisma, products.map(p => p.name));
    return { items: products.map(p => {
      const sizes = states.get(p.name)?.sizes.filter(s => p.sizes.some(active => active.size === s.size)) ?? [];
      return { ...toProductDto(p, Math.max(0, ...sizes.map(s => s.cups))),
        sizeAvailability: sizes.map(s => ({ size: s.size, maxQuantity: s.cups, available: s.available })) };
    }), currency: 'VND' };
  }

  async getProduct(id: string): Promise<ProductDetailDto> {
    const normalizedId = String(normalizeCatalogId(id));
    const product = await this.prisma.product.findUnique({
      where: { id: normalizedId },
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
    const state = (await productIngredientStates(this.prisma, [product.name])).get(product.name);
    const sizes = product.sizes.sort((a, b) => sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size));
    const toppings = [...product.toppings].sort((a,b) => compareIds(a.topping.id,b.topping.id));
    const configurations = toppings.flatMap(({topping}) => sizes.map(s => ({name:product.name,size:s.size,toppings:[topping.name]})));
    const capacities = await configurationIngredientStates(this.prisma, configurations);
    return {
      ...toProductDto(product, Math.max(0, ...sizes.map(s => state?.sizes.find(a => a.size === s.size)?.cups ?? 0))),
      sizes: sizes.map(({size,extraPrice}) => ({size,extraPrice:extraPrice.toFixed(0),
        available:state?.sizes.find(s => s.size === size)?.available ?? false,
        maxQuantity:state?.sizes.find(s => s.size === size)?.cups ?? 0})),
      toppings: toppings.map(({ topping }, index) => ({
          id: topping.id, name: topping.name, price: topping.price.toFixed(0),
          availableSizes:sizes.filter((_s,offset) => capacities[index*sizes.length+offset]?.available).map(s => s.size),
        })),
    };
  }
}

function toProductDto(product: CatalogRow, capacity: number): CatalogProductDto {
  return {
    id: product.id,
    name: product.name,
    price: product.price.toFixed(0),
    imageUrl: product.imageUrl,
    // Chỉ dựa công thức và nguyên liệu khả dụng, không dùng Product.stock.
    available: product.isActive && capacity > 0 && product.sizes.some(s => ['S', 'M', 'L'].includes(s.size)),
  };
}
