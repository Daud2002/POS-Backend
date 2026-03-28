import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
  ) {}

  async create(createProductDto: CreateProductDto, storeId: string): Promise<Product> {
    const product = this.productsRepository.create({ ...createProductDto, storeId });
    return await this.productsRepository.save(product);
  }

  async findAll(storeId: string, skip?: number, take?: number): Promise<Product[]> {
    return await this.productsRepository.find({
      where: { storeId },
      relations: ['category'],
      skip,
      take,
    });
  }

  async findOne(id: string, storeId?: string): Promise<Product> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;
    
    const product = await this.productsRepository.findOne({
      where,
      relations: ['category'],
    });
    if (!product) {
      throw new NotFoundException(`Product #${id} not found`);
    }
    if (storeId && product.storeId !== storeId) {
      throw new ForbiddenException('You do not have access to this product');
    }
    return product;
  }

  async update(
    id: string,
    updateProductDto: UpdateProductDto,
    storeId: string,
  ): Promise<Product> {
    const product = await this.findOne(id, storeId);
    const updated = this.productsRepository.merge(product, updateProductDto);
    return await this.productsRepository.save(updated);
  }

  async remove(id: string, storeId: string): Promise<void> {
    const product = await this.findOne(id, storeId);
    await this.productsRepository.remove(product);
  }

  async findByCategory(categoryId: string, storeId: string): Promise<Product[]> {
    return await this.productsRepository.find({
      where: { categoryId, storeId },
      relations: ['category'],
    });
  }

  async deductStock(id: string, quantity: number, storeId: string): Promise<Product> {
    const product = await this.findOne(id, storeId);
    
    if (product.stock < quantity) {
      throw new BadRequestException(`Insufficient stock for product "${product.name}". Available: ${product.stock}, Requested: ${quantity}`);
    }
    
    product.stock -= quantity;
    return await this.productsRepository.save(product);
  }
}
