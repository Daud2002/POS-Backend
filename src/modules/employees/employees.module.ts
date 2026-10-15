import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { Employee, User } from '@/entities';
import { AuthModule } from '@/auth/auth.module';
import { RealtimeModule } from '@/realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Employee, User]), AuthModule, RealtimeModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
