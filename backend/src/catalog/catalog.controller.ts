import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto, ProductParamsDto, type ProductDetailDto, type ProductListDto } from './dto/catalog.dto';

@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  // GET /products: Trả danh sách đồ uống đang kinh doanh kèm trạng thái khả dụng
  @Get()
  list(@Query() _query: CatalogQueryDto): Promise<ProductListDto> {
    void _query; // DTO exists to validate that no query options were supplied.
    return this.catalog.listProducts();
  }

  @Get(':id')
  detail(@Param() params: ProductParamsDto, @Query() _query: CatalogQueryDto): Promise<ProductDetailDto> {
    void _query;
    return this.catalog.getProduct(params.id);
  }
}
