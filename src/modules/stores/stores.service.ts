import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from '@/entities';
import { CreateStoreDto, UpdateStoreDto } from './dto';

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
  ) {}

  async findAll(skip = 0, take = 10) {
    return await this.storesRepository.find({
      skip,
      take,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    return await this.storesRepository.findOne({ where: { id } });
  }

  async create(createStoreDto: CreateStoreDto) {
    const store = this.storesRepository.create(createStoreDto);
    return await this.storesRepository.save(store);
  }

  async update(id: string, updateStoreDto: UpdateStoreDto) {
    const store = await this.storesRepository.findOne({ where: { id } });
    if (!store) {
      throw new Error(`Store with ID ${id} not found`);
    }
    Object.assign(store, updateStoreDto);
    return await this.storesRepository.save(store);
  }

  async delete(id: string) {
    const result = await this.storesRepository.delete(id);
    if (result.affected === 0) {
      throw new Error(`Store with ID ${id} not found`);
    }
    return { message: 'Store deleted successfully' };
  }
}
