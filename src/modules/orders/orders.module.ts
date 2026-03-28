import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, OrderItem, Product, Store, Employee } from '../../entities';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem, Product, Store, Employee]), ProductsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
