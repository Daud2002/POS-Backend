import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, OrderItem, Product, RestaurantTable, Store, Employee } from '../../entities';
import { RestaurantController } from './restaurant.controller';
import { TablesService } from './tables.service';
import { RestaurantOrdersService } from './restaurant-orders.service';
import { RestaurantReportsService } from './restaurant-reports.service';
import { RealtimeModule } from '../../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product, RestaurantTable, Store, Employee]),
    RealtimeModule,
  ],
  controllers: [RestaurantController],
  providers: [TablesService, RestaurantOrdersService, RestaurantReportsService],
  exports: [TablesService, RestaurantOrdersService],
})
export class RestaurantModule {}
