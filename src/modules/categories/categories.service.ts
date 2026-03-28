import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../../entities';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private categoriesRepository: Repository<Category>,
  ) {}

  async create(createCategoryDto: CreateCategoryDto, storeId: string): Promise<Category> {
    const category = this.categoriesRepository.create({ ...createCategoryDto, storeId });
    return await this.categoriesRepository.save(category);
  }

  async findAll(storeId: string, skip?: number, take?: number): Promise<Category[]> {
    return await this.categoriesRepository.find({
      where: { storeId },
      relations: ['products'],
      skip,
      take,
    });
  }

  async findOne(id: string, storeId?: string): Promise<Category> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;
    
    const category = await this.categoriesRepository.findOne({
      where,
      relations: ['products'],
    });
    if (!category) {
      throw new NotFoundException(`Category #${id} not found`);
    }
    if (storeId && category.storeId !== storeId) {
      throw new ForbiddenException('You do not have access to this category');
    }
    return category;
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    storeId: string,
  ): Promise<Category> {
    const category = await this.findOne(id, storeId);
    const updated = this.categoriesRepository.merge(category, updateCategoryDto);
    return await this.categoriesRepository.save(updated);
  }

  async remove(id: string, storeId: string): Promise<void> {
    const category = await this.findOne(id, storeId);
    await this.categoriesRepository.remove(category);
  }
}
