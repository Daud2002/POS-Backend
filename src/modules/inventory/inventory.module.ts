import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItem, InventoryMovement, Product, ProductIngredient } from '@/entities';
import { RealtimeModule } from '../../realtime/realtime.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItem, InventoryMovement, ProductIngredient, Product]),
    RealtimeModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  // The restaurant module draws stock down when an order is settled.
  exports: [InventoryService],
})
export class InventoryModule {}
