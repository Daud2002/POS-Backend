import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Store, Employee, RefreshToken } from '../entities';
import { RefreshTokenService } from './refresh-token.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Store, Employee, RefreshToken]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {

        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) throw new Error('JWT_SECRET is missing');

        // MUST be a unit-suffixed string ('30m', '7d'). A bare numeric string
        // like '86400' is parsed by `ms()` as MILLISECONDS, so it yields an
        // 86-second token, not 24 hours. That was the cause of users being
        // logged out mid-session. Only a real `number` means seconds.
        const expiresIn = configService.get<string>('JWT_ACCESS_EXPIRATION', '30m');
        if (/^\d+$/.test(expiresIn)) {
          throw new Error(
            `JWT_ACCESS_EXPIRATION must carry a unit (e.g. '30m', '1d'); got '${expiresIn}', ` +
              `which jsonwebtoken would read as ${expiresIn} milliseconds.`,
          );
        }

        return {
          secret,
          // Cast: `expiresIn` is typed as ms's `StringValue` template-literal
          // union, which a config-sourced string can't satisfy statically. The
          // runtime guard above is what actually enforces the format.
          signOptions: { expiresIn: expiresIn as `${number}${'m' | 'h' | 'd'}` },
        }
      },
    }),
  ],
  providers: [AuthService, JwtStrategy, RefreshTokenService],
  controllers: [AuthController],
  // JwtModule is re-exported so RealtimeGateway can verify tokens on the
  // socket handshake using the same secret and options as the HTTP guard.
  exports: [AuthService, RefreshTokenService, JwtModule],
})
export class AuthModule { }