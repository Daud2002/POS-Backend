import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { IMPERSONATION_LINK_TYPE } from './impersonation.service';

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
    // Impersonation LINKS are signed with their own secret, so they should
    // never verify here — but if the two secrets were ever set to the same
    // value, this is what keeps a link from doubling as an access token.
    if (payload?.typ === IMPERSONATION_LINK_TYPE) {
      throw new UnauthorizedException('Not an access token');
    }

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

    const profile = await this.authService.getUserWithStore(user);

    // A session opened through an impersonation link names the admin on
    // every request, so audit rows and the "viewing as" banner can show it.
    if (payload?.imp) {
      profile.impersonatedBy = (await this.authService.describeImpersonator(String(payload.imp))) ?? {
        id: String(payload.imp),
        name: null,
      };
    }

    return profile;
  }
}
