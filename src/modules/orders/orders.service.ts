import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderItem, Product } from '../../entities';
import { CreateOrderDto, UpdateOrderDto } from './dto/order.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
  ) {}

  async create(createOrderDto: CreateOrderDto, userId: string): Promise<Order> {
    const { items, tax = 0, discount = 0, ...orderData } = createOrderDto;

    // Generate order number
    const orderNumber = `ORD-${Date.now()}`;

    // Calculate totals
    let subtotal = 0;
    const orderItems: OrderItem[] = [];

    for (const item of items) {
      const product = await this.productsRepository.findOne({
        where: { id: item.productId },
      });

      if (!product) {
        throw new BadRequestException(`Product ${item.productId} not found`);
      }

      const itemTotal = item.quantity * item.unitPrice;
      subtotal += itemTotal;

      const orderItem = this.orderItemsRepository.create({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: itemTotal,
        discount: 0,
        total: itemTotal,
      });

      orderItems.push(orderItem);
    }

    const total = subtotal + (tax || 0) - (discount || 0);

    const order = this.ordersRepository.create({
      ...orderData,
      orderNumber,
      subtotal,
      tax: tax || 0,
      discount: discount || 0,
      total,
      createdById: userId,
      paymentMethod: (orderData.paymentMethod || 'cash') as any,
      items: orderItems,
    });

    return await this.ordersRepository.save(order);
  }

  async findAll(skip?: number, take?: number): Promise<Order[]> {
    return await this.ordersRepository.find({
      relations: ['customer', 'createdBy', 'items', 'items.product'],
      skip,
      take,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: ['customer', 'createdBy', 'items', 'items.product'],
    });

    if (!order) {
      throw new NotFoundException(`Order #${id} not found`);
    }

    return order;
  }

  async update(id: string, updateOrderDto: UpdateOrderDto): Promise<Order> {
    const order = await this.findOne(id);
    const updated = this.ordersRepository.merge(order, updateOrderDto as any);
    return await this.ordersRepository.save(updated);
  }

  async remove(id: string): Promise<void> {
    const order = await this.findOne(id);
    await this.ordersRepository.remove(order);
  }

  async findByCustomer(customerId: string): Promise<Order[]> {
    return await this.ordersRepository.find({
      where: { customerId },
      relations: ['items', 'items.product'],
      order: { createdAt: 'DESC' },
    });
  }
}
