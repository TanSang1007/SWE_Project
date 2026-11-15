import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { CatalogProductDto, ProductDetailDto, ProductListDto } from './dto/catalog.dto';
import { configurationIngredientStates, productIngredientStates } from './product-ingredients';

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
    const states = await productIngredientStates(this.prisma, products.map(p => p.name));
    return { items: products.map(p => {
      const state = states.get(p.name);
      const sizes = state?.sizes.filter(s => p.sizes.some(active => active.size === s.size));
      return { ...toProductDto(p, sizes ? Math.max(0, ...sizes.map(s => s.cups)) : undefined),
        ...(sizes ? { sizeAvailability: sizes.map(s => ({ size: s.size, maxQuantity: s.cups, stockStatus: s.status })) } : {}) };
    }), currency: 'VND' };
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
    const states = await productIngredientStates(this.prisma, [product.name]);
    const state = states.get(product.name);
    const selections = product.toppings.flatMap(({ topping }) => product.sizes.map(size => ({ name: product.name, size: size.size, toppings: [topping.name] })));
    const toppingStates = await configurationIngredientStates(this.prisma, selections);
    return {
      ...toProductDto(product, state ? Math.max(0, ...state.sizes.filter(s => product.sizes.some(active => active.size === s.size)).map(s => s.cups)) : undefined),
      sizes: product.sizes.sort((a, b) => sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size))
        .map(({ size, extraPrice }) => {
          const availability = state?.sizes.find(s => s.size === size);
          return { size, extraPrice: extraPrice.toFixed(0), ...(availability ? { available: availability.available, maxQuantity: availability.cups, stockStatus: availability.status } : {}) };
        }),
      toppings: product.toppings.map(({ topping }, index) => ({
        id: topping.id, name: topping.name, price: topping.price.toFixed(0),
        ...(state ? { availableSizes: selections.slice(index * product.sizes.length, (index + 1) * product.sizes.length).filter((_selection, offset) => toppingStates[index * product.sizes.length + offset]?.available).map(selection => selection.size) } : {}),
      })),
    };
  }
}

function toProductDto(product: CatalogRow, capacity?: number): CatalogProductDto {
  return {
    id: product.id,
    name: product.name,
    price: product.price.toFixed(0),
    imageUrl: product.imageUrl,
    available: product.isActive && (capacity === undefined ? product.stock > 0 : capacity > 0) && product.sizes.some(s => ['S', 'M', 'L'].includes(s.size)),
    ...(capacity === undefined ? {} : { stockStatus: capacity === 0 ? 'OUT_OF_STOCK' : capacity <= 10 ? 'LOW_STOCK' : 'IN_STOCK' }),
  };
}

