import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from '@/entities';
import { User } from '@/entities';
import { Employee } from '@/entities';
import { CreateStoreDto, UpdateStoreDto } from './dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
  ) {}

  async findAll(skip = 0, take = 10) {
    return await this.storesRepository.find({
      skip,
      take,
      order: { createdAt: 'DESC' },
      relations: ['owner'],
    });
  }

  async findOne(id: string) {
    return await this.storesRepository.findOne({
      where: { id },
      relations: ['owner'],
    });
  }

  async create(createStoreDto: CreateStoreDto) {
    // Check if email already exists
    const existingUser = await this.usersRepository.findOne({
      where: { email: createStoreDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // Create user for store owner
    const hashedPassword = await bcrypt.hash(createStoreDto.password, 10);
    const user = this.usersRepository.create({
      email: createStoreDto.email,
      passwordHash: hashedPassword,
      role: 'store_owner' as any,
      isActive: true,
    });

    const savedUser = await this.usersRepository.save(user);

    // Create store with userId reference
    const store = this.storesRepository.create({
      ...createStoreDto,
      userId: savedUser.id,
    });

    // Remove password from the DTO before saving to store
    delete (store as any).password;

    return await this.storesRepository.save(store);
  }

  async update(id: string, updateStoreDto: UpdateStoreDto) {
    const store = await this.storesRepository.findOne({ where: { id } });
    if (!store) {
      throw new BadRequestException(`Store with ID ${id} not found`);
    }
    Object.assign(store, updateStoreDto);
    return await this.storesRepository.save(store);
  }

  async delete(id: string) {
    const store = await this.storesRepository.findOne({ where: { id } });
    if (!store) {
      throw new BadRequestException(`Store with ID ${id} not found`);
    }

    const employees = await this.employeesRepository.find({
      where: { storeId: id },
    });
    console.log(`Deleting ${employees.length} employees associated with store ID ${id}`);

    for (const employee of employees) {
      if (employee.userId) {
        await this.employeesRepository.delete(employee.id);
        await this.usersRepository.delete(employee.userId);
      }
    }

    await this.employeesRepository.delete({ storeId: id });
    const result = await this.storesRepository.delete(id);

    if (store.userId) {
      await this.usersRepository.delete(store.userId);
    }

    if (result.affected === 0) {
      throw new BadRequestException(`Store with ID ${id} not found`);
    }
    return { message: 'Store and associated user deleted successfully' };
  }
}
