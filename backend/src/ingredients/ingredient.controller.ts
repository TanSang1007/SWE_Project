import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { UserRole } from '../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CountCreateDto, CountReviewDto, IngredientCreateDto, IngredientEmptyDto, IngredientPageDto, IngredientParamsDto, IngredientVersionDto, ReceiptCreateDto } from './ingredient.dto';
import { IngredientService } from './ingredient.service';
type ActorRequest = Request & { user: { id: string; role: UserRole } };
@Controller('ingredient-inventory') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'STAFF')
export class IngredientController {
  constructor(private readonly inventory: IngredientService) {}
  @Post('catalog/initialize') @Roles('ADMIN') @HttpCode(200) @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  initializeCatalog(@Req() req:ActorRequest,@Query() query:IngredientEmptyDto,@Body() body:IngredientEmptyDto){void query;void body;return this.inventory.initializeCatalog(req.user.id);}
  @Get('summary') @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  summary(@Req() req: ActorRequest, @Query() query: IngredientEmptyDto, @Body() body: IngredientEmptyDto) { void query; void body; return this.inventory.summary(req.user.id,req.user.role); }
  @Get('ingredients') @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  ingredients(@Query() query: IngredientEmptyDto, @Body() body: IngredientEmptyDto) { void query; void body; return this.inventory.ingredients(); }
  @Post('ingredients') @Roles('ADMIN') @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  createIngredient(@Req() req: ActorRequest, @Headers('idempotency-key') key: string | undefined, @Body() body: IngredientCreateDto, @Query() query: IngredientEmptyDto) { void query; return this.inventory.createIngredient(req.user.id,key,body); }
  @Get('receipts') @Roles('ADMIN') @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  receipts(@Query() query: IngredientPageDto, @Body() body: IngredientEmptyDto) { void body; return this.inventory.receipts(query.cursor); }
  @Post('receipts') @Roles('ADMIN') @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  createReceipt(@Req() req: ActorRequest, @Headers('idempotency-key') key: string | undefined, @Body() body: ReceiptCreateDto, @Query() query: IngredientEmptyDto) { void query; return this.inventory.createReceipt(req.user.id,key,body); }
  @Post('receipts/:id/confirm') @Roles('ADMIN') @HttpCode(200) @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  confirm(@Req() req: ActorRequest, @Param() params: IngredientParamsDto, @Body() body: IngredientVersionDto, @Query() query: IngredientEmptyDto) { void query; return this.inventory.confirmReceipt(req.user.id,params.id.toLowerCase(),body.expectedVersion); }
  @Get('counts') @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  counts(@Req() req: ActorRequest, @Query() query: IngredientPageDto, @Body() body: IngredientEmptyDto) { void body; return this.inventory.counts(req.user.id,req.user.role,query.cursor); }
  @Post('counts') @Roles('STAFF') @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  createCount(@Req() req: ActorRequest, @Headers('idempotency-key') key: string | undefined, @Body() body: CountCreateDto, @Query() query: IngredientEmptyDto) { void query; return this.inventory.createCount(req.user.id,key,body); }
  @Post('counts/:id/review') @Roles('ADMIN') @HttpCode(200) @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  review(@Req() req: ActorRequest, @Param() params: IngredientParamsDto, @Body() body: CountReviewDto, @Query() query: IngredientEmptyDto) { void query; return this.inventory.reviewCount(req.user.id,params.id.toLowerCase(),body); }
  @Get('movements') @Roles('ADMIN') @Header('Cache-Control','private, no-store, max-age=0') @Header('Vary','Authorization, Origin')
  movements(@Query() query: IngredientPageDto, @Body() body: IngredientEmptyDto) { void body; return this.inventory.movements(query.cursor); }
}
