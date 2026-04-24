import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, Store } from '../../entities';

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: Date;
  order: {
    id: string;
    orderNumber: string;
    createdAt: Date;
    status: string;
    subtotal: number;
    tax: number;
    discount: number;
    total: number;
    paymentMethod: string;
    items: any[];
  };
  customer?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  store?: {
    id: string;
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    currency?: string;
  };
}

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
  ) {}

  async generateInvoiceData(orderId: string, storeId?: string): Promise<InvoiceData> {
    // Fetch order with relations
    const order = await this.ordersRepository.findOne({
      where: storeId ? { id: orderId, storeId } : { id: orderId },
      relations: ['customer', 'items', 'items.product', 'createdBy'],
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    // Fetch store info
    let store = null;
    if (order.storeId) {
      store = await this.storesRepository.findOne({
        where: { id: order.storeId },
      });
    }

    // Build invoice data
    const invoiceData: InvoiceData = {
      invoiceNumber: `INV-${order.orderNumber.replace('ORD-', '')}`,
      invoiceDate: new Date(),
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        status: order.status,
        subtotal: Number(order.subtotal),
        tax: Number(order.tax),
        discount: Number(order.discount),
        total: Number(order.total),
        paymentMethod: order.paymentMethod,
        items: order.items.map(item => ({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discount: Number(item.discount),
          subtotal: Number(item.subtotal),
          total: Number(item.total),
        })),
      },
    };

    // Add customer info if exists
    if (order.customer) {
      invoiceData.customer = {
        id: order.customer.id,
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
        address: order.customer.address,
      };
    }

    // Add store info if exists
    if (store) {
      invoiceData.store = {
        id: store.id,
        name: store.name,
        address: store.address,
        phone: store.phone,
        email: store.email,
        currency: store.currency,
      };
    }

    return invoiceData;
  }

  async getOrderInvoiceData(orderId: string): Promise<InvoiceData> {
    return this.generateInvoiceData(orderId);
  }
}
