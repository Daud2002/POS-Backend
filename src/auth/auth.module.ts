import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Store, Employee } from '../entities';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Store, Employee]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {

        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) throw new Error('JWT_SECRET is missing');

        return {
          secret,
          signOptions: { expiresIn: configService.get('JWT_EXPIRATION', '1d') },
        }
      },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule { }