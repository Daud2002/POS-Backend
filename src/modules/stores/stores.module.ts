import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoresController } from './stores.controller';
import { StoreLogoController } from './store-logo.controller';
import { StoresService } from './stores.service';
import { SubscriptionService } from './subscription.service';
import { Store, User, Employee, SubscriptionPayment } from '@/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Store, User, Employee, SubscriptionPayment])],
  // The logo controller is separate because it must NOT carry the JWT guard.
  controllers: [StoresController, StoreLogoController],
  providers: [StoresService, SubscriptionService],
  exports: [StoresService],
})
export class StoresModule {}
