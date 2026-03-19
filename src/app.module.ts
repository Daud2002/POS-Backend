import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { typeormConfig } from './database/typeorm.config';
import { User, Category, Product, Customer, Order, OrderItem, Store } from './entities';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CustomersModule } from './modules/customers/customers.module';
import { OrdersModule } from './modules/orders/orders.module';
import { StoresModule } from './modules/stores/stores.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot(typeormConfig()),
    TypeOrmModule.forFeature([User, Category, Product, Customer, Order, OrderItem, Store]),
    AuthModule,
    ProductsModule,
    CategoriesModule,
    CustomersModule,
    OrdersModule,
    StoresModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
