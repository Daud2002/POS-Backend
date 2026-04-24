import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { typeormConfig } from './database/typeorm.config';
import { User, Category, Product, Customer, Order, OrderItem, Store, Employee } from './entities';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CustomersModule } from './modules/customers/customers.module';
import { OrdersModule } from './modules/orders/orders.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { StoresModule } from './modules/stores/stores.module';
import { UsersModule } from './modules/users/users.module';
import { EmployeesModule } from './modules/employees/employees.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot(typeormConfig()),
    TypeOrmModule.forFeature([User, Category, Product, Customer, Order, OrderItem, Store, Employee]),
    AuthModule,
    ProductsModule,
    CategoriesModule,
    CustomersModule,
    OrdersModule,
    InvoicesModule,
    StoresModule,
    UsersModule,
    EmployeesModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
