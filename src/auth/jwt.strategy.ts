import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';


@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET', 'default_jwt_secret');

    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }
    
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: any) {
    const user = await this.usersRepository.findOne({
      where: { id: payload.sub },
    });
    if (!user) return null;

    // Checked per request, not just at login and refresh: otherwise an access
    // token issued before the account or its store was deactivated keeps
    // working for up to JWT_ACCESS_EXPIRATION. The 401 sends the client to
    // /auth/refresh, which refuses too, and the client signs itself out.
    const inactive = await this.authService.inactiveReason(user);
    if (inactive) throw new UnauthorizedException(inactive);

    return await this.authService.getUserWithStore(user);
  }
}
