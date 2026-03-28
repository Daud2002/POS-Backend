import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category, Store, Employee } from '../../entities';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Store, Employee])],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
