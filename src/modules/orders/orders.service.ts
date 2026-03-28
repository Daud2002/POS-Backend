import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderItem, Product, Store, Employee } from '../../entities';
import { CreateOrderDto, UpdateOrderDto } from './dto/order.dto';
import { ProductsService } from '../products/products.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
    private productsService: ProductsService,
  ) {}

  private async getStoreIdFromUser(user: any): Promise<string | undefined> {
    if (user.role === 'admin') {
      return undefined;
    } else if (user.role === 'store_owner') {
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

  async create(createOrderDto: CreateOrderDto, userId: string, storeId?: string): Promise<Order> {
    if (!storeId) {
      throw new BadRequestException('Store ID is required to create an order');
    }

    const { items, tax = 0, discount = 0, ...orderData } = createOrderDto;

    const orderNumber = `ORD-${Date.now()}`;

    let subtotal = 0;
    const orderItems: OrderItem[] = [];

    for (const item of items) {
      const product = await this.productsRepository.findOne({
        where: { id: item.productId, storeId },
      });

      if (!product) {
        throw new BadRequestException(`Product ${item.productId} not found or does not belong to your store`);
      }
      if (product.stock < item.quantity) {
        throw new BadRequestException(`Insufficient stock for product "${product.name}". Available: ${product.stock}, Requested: ${item.quantity}`);
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
      storeId,
      orderNumber,
      customerId: orderData.customerId,
      createdById: userId,
      subtotal,
      tax: tax || 0,
      discount: discount || 0,
      total,
      notes: orderData.notes,
      paymentMethod: (orderData.paymentMethod || 'cash') as 'cash' | 'card' | 'check' | 'online',
      items: orderItems,
    });

    const savedOrder = await this.ordersRepository.save(order);

    for (const item of items) {
      await this.productsService.deductStock(item.productId, item.quantity, storeId);
    }

    return savedOrder;
  }

  async findAll(storeId?: string, skip?: number, take?: number): Promise<Order[]> {
    const where: any = {};
    if (storeId) {
      where.storeId = storeId;
    }
    
    return await this.ordersRepository.find({
      where,
      relations: ['customer', 'createdBy', 'items', 'items.product'],
      skip,
      take,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, storeId?: string): Promise<Order> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;
    
    const order = await this.ordersRepository.findOne({
      where,
      relations: ['customer', 'createdBy', 'items', 'items.product'],
    });

    if (!order) {
      throw new NotFoundException(`Order #${id} not found`);
    }

    if (storeId && order.storeId !== storeId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    return order;
  }

  async update(id: string, updateOrderDto: UpdateOrderDto, storeId?: string): Promise<Order> {
    const order = await this.findOne(id, storeId);
    const updated = this.ordersRepository.merge(order, updateOrderDto as any);
    return await this.ordersRepository.save(updated);
  }

  async remove(id: string, storeId?: string): Promise<void> {
    const order = await this.findOne(id, storeId);
    await this.ordersRepository.remove(order);
  }

  async findByCustomer(customerId: string, storeId?: string): Promise<Order[]> {
    const where: any = { customerId };
    if (storeId) {
      where.storeId = storeId;
    }

    return await this.ordersRepository.find({
      where,
      relations: ['items', 'items.product'],
      order: { createdAt: 'DESC' },
    });
  }
}
