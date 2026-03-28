import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, Employee } from '../../entities';
import { Request } from 'express';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
  ) {}

  private async getStoreIdFromUser(user: any): Promise<string> {
    if (user.role === 'store_owner') {
      const store = await this.storesRepository.findOne({ where: { userId: user.id } });
      if (!store) throw new BadRequestException('Store not found for this user');
      return store.id;
    } else if (user.role === 'employee' || user.role === 'cashier') {
      const employee = await this.employeesRepository.findOne({ where: { userId: user.id } });
      if (!employee) throw new BadRequestException('Employee record not found');
      return employee.storeId;
    }
    throw new BadRequestException('Invalid user role for this operation');
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new product' })
  @ApiResponse({ status: 201, description: 'Product created successfully' })
  async create(@Req() req: Request, @Body() createProductDto: CreateProductDto) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.productsService.create(createProductDto, storeId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all products for store' })
  @ApiQuery({ name: 'storeId', required: true, type: String })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of products' })
  findAll(@Query('storeId') storeId?: string, @Query('skip') skip?: number, @Query('take') take?: number) {
    if (!storeId) throw new BadRequestException('storeId query parameter is required');
    return this.productsService.findAll(storeId, skip, take);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiResponse({ status: 200, description: 'Product found' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a product' })
  @ApiResponse({ status: 200, description: 'Product updated successfully' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.productsService.update(id, updateProductDto, storeId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a product' })
  @ApiResponse({ status: 200, description: 'Product deleted successfully' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.productsService.remove(id, storeId);
  }

  @Get('category/:categoryId')
  @ApiOperation({ summary: 'Get products by category' })
  @ApiQuery({ name: 'storeId', required: true, type: String })
  findByCategory(@Param('categoryId') categoryId: string, @Query('storeId') storeId?: string) {
    if (!storeId) throw new BadRequestException('storeId query parameter is required');
    return this.productsService.findByCategory(categoryId, storeId);
  }
}
