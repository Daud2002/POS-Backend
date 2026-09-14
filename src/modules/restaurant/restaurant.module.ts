import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Order,
  OrderEvent,
  OrderItem,
  Product,
  RestaurantTable,
  Store,
  Employee,
} from '../../entities';
import { RestaurantController } from './restaurant.controller';
import { TablesService } from './tables.service';
import { RestaurantOrdersService } from './restaurant-orders.service';
import { RestaurantReportsService } from './restaurant-reports.service';
import { OrderSequenceResetService } from './order-sequence-reset.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderEvent,
      Product,
      RestaurantTable,
      Store,
      Employee,
    ]),
    RealtimeModule,
    // settle() stamps the money onto the cashier's open drawer.
    ShiftsModule,
    // A delivery order files its customer into the store's directory.
    CustomersModule,
  ],
  controllers: [RestaurantController],
  providers: [
    TablesService,
    RestaurantOrdersService,
    RestaurantReportsService,
    OrderSequenceResetService,
  ],
  exports: [TablesService, RestaurantOrdersService],
})
export class RestaurantModule {}
