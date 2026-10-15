import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Employee } from '../../entities/employee.entity';
import { AuthModule } from '../../auth/auth.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Employee]), AuthModule, RealtimeModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
