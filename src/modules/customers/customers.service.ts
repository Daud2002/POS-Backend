import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer, Order } from '../../entities';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { toPage, type Page } from '../../common/pagination';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private customersRepository: Repository<Customer>,
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
  ) {}

  async create(createCustomerDto: CreateCustomerDto): Promise<Customer> {
    const customer = this.customersRepository.create(createCustomerDto);
    return await this.customersRepository.save(customer);
  }

  async findAll(skip?: number, take?: number): Promise<Customer[]> {
    return await this.customersRepository.find({
      relations: ['orders'],
      skip,
      take,
    });
  }

  async findAllPaged(skip: number, take: number): Promise<Page<Customer>> {
    const [items, total] = await this.customersRepository.findAndCount({
      relations: ['orders'],
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
    return toPage(items, total, skip, take);
  }

  async findOne(id: string): Promise<Customer> {
    const customer = await this.customersRepository.findOne({
      where: { id },
      relations: ['orders'],
    });
    if (!customer) {
      throw new NotFoundException(`Customer #${id} not found`);
    }
    return customer;
  }

  async getCustomerWithOrders(id: string): Promise<{ customer: Customer; orders: Order[] }> {
    const customer = await this.findOne(id);
    const orders = await this.ordersRepository.find({
      where: { customerId: id },
      relations: ['items', 'items.product', 'createdBy'],
      order: { createdAt: 'DESC' },
    });
    return { customer, orders };
  }

  async update(
    id: string,
    updateCustomerDto: UpdateCustomerDto,
  ): Promise<Customer> {
    const customer = await this.findOne(id);
    const updated = this.customersRepository.merge(customer, updateCustomerDto);
    return await this.customersRepository.save(updated);
  }

  async remove(id: string): Promise<void> {
    const customer = await this.findOne(id);
    await this.customersRepository.remove(customer);
  }
}
