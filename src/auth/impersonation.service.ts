import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { User } from '../entities';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';

/** Marks a link token so it can never be mistaken for an access token. */
export const IMPERSONATION_LINK_TYPE = 'impersonation-link';

export interface ImpersonationLinkPayload {
  /** The user the link signs in as. */
  sub: string;
  /** The platform admin who made it. */
  adm: string;
  typ: typeof IMPERSONATION_LINK_TYPE;
  jti: string;
  exp?: number;
}

/**
 * "Open as owner" / "Open as employee" for the platform admin, without the
 * admin ever knowing the customer's password.
 *
 * Stateless by design — nothing is written to the database:
 *  - A LINK is a JWT signed with IMPERSONATION_SECRET (not JWT_SECRET, so a
 *    link can never pass JwtStrategy and an access token can never be
 *    exchanged here), naming the target, the admin and a unique id, and
 *    expiring an hour after it was made.
 *  - EXCHANGING a link verifies it and issues an ordinary access token for
 *    the target that carries the admin's id (`imp`), good for one hour, with
 *    NO refresh token: the session ends when the hour does.
 *  - Each link works ONCE. Used ids are kept in memory until their own
 *    expiry, so a replay within the hour is refused. A process restart
 *    forgets the list — an unexpired link could then be replayed until it
 *    expires — which is the accepted cost of keeping this table-free.
 *
 * Every exchange is written to the audit log with the admin as actor, and
 * everything done in the session is attributed to both (see AuditInterceptor).
 */
@Injectable()
export class ImpersonationService implements OnModuleInit {
  private readonly logger = new Logger(ImpersonationService.name);

  static readonly LINK_TTL_SECONDS = 60 * 60;
  static readonly MIN_SECRET_LENGTH = 32;
  /** Exchange attempts allowed per minute, per address and overall. */
  static readonly PER_IP_LIMIT = 10;
  static readonly GLOBAL_LIMIT = 100;

  /** jti → the link's own expiry (ms), after which the entry is dropped. */
  private readonly usedLinks = new Map<string, number>();
  /** ip → recent attempt timestamps (ms). */
  private readonly attempts = new Map<string, number[]>();

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    if (!this.secret()) {
      this.logger.warn(
        `IMPERSONATION_SECRET is not set (or shorter than ${ImpersonationService.MIN_SECRET_LENGTH} characters); ` +
          '"Open as owner / employee" will answer 503 until it is',
      );
    }
  }

  isConfigured(): boolean {
    return this.secret() !== null;
  }

  async issueLink(admin: { id: string; name?: string | null }, targetUserId: string) {
    const secret = this.requireSecret();

    const target = await this.users.findOne({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'admin') throw new ForbiddenException('Platform admins cannot be impersonated');
    if (target.id === admin.id) throw new BadRequestException('You are already signed in as this user');

    const inactive = await this.authService.inactiveReason(target);
    if (inactive) throw new BadRequestException(`This account cannot be opened: ${inactive}`);

    const profile = await this.authService.getUserWithStore(target);
    const payload: ImpersonationLinkPayload = {
      sub: target.id,
      adm: admin.id,
      typ: IMPERSONATION_LINK_TYPE,
      jti: randomUUID(),
    };
    const token = this.jwtService.sign(payload, {
      secret,
      expiresIn: ImpersonationService.LINK_TTL_SECONDS,
    });

    return {
      token,
      expiresAt: new Date(Date.now() + ImpersonationService.LINK_TTL_SECONDS * 1000).toISOString(),
      target: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: profile.effectiveRole ?? target.role,
        storeId: profile.storeId ?? null,
        storeName: profile.storeName ?? null,
      },
    };
  }

  async exchange(token: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    const secret = this.requireSecret();
    this.throttle(meta.ip ?? null);

    let payload: ImpersonationLinkPayload;
    try {
      payload = this.jwtService.verify<ImpersonationLinkPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('This link is invalid or has expired');
    }
    if (payload?.typ !== IMPERSONATION_LINK_TYPE || !payload.sub || !payload.adm || !payload.jti) {
      throw new UnauthorizedException('This link is invalid or has expired');
    }

    if (!this.markUsed(payload.jti, payload.exp)) {
      throw new UnauthorizedException('This link has already been used');
    }

    const target = await this.users.findOne({ where: { id: payload.sub } });
    if (!target || target.role === 'admin') {
      throw new UnauthorizedException('This account is no longer available');
    }
    const inactive = await this.authService.inactiveReason(target);
    if (inactive) throw new UnauthorizedException(inactive);

    const admin = (await this.authService.describeImpersonator(payload.adm)) ?? {
      id: payload.adm,
      name: 'Platform admin',
    };

    const session = await this.authService.impersonate(target, admin, meta.userAgent ?? undefined);
    const profile = session.user;

    void this.audit.log({
      module: 'auth',
      action: 'impersonation.started',
      entityType: 'user',
      entityId: target.id,
      summary:
        `${admin.name ?? 'Platform admin'} opened ${profile.name ?? target.email}'s account` +
        (profile.storeName ? ` (${profile.storeName})` : ''),
      storeId: profile.storeId ?? null,
      actorId: admin.id,
      actorName: admin.name ?? null,
      actorRole: 'super_admin',
      impersonatorId: admin.id,
      method: 'POST',
      path: '/api/auth/impersonation-links/exchange',
      statusCode: 201,
      payload: { targetUserId: target.id, linkId: payload.jti },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return session;
  }

  private secret(): string | null {
    const value = this.config.get<string>('IMPERSONATION_SECRET')?.trim();
    return value && value.length >= ImpersonationService.MIN_SECRET_LENGTH ? value : null;
  }

  private requireSecret(): string {
    const secret = this.secret();
    if (!secret) {
      throw new ServiceUnavailableException('Impersonation is not configured on this server');
    }
    return secret;
  }

  /** True the first time a link id is seen; false on any replay. */
  private markUsed(jti: string, exp: number | undefined): boolean {
    const now = Date.now();
    for (const [id, expiresAt] of this.usedLinks) {
      if (expiresAt <= now) this.usedLinks.delete(id);
    }
    if (this.usedLinks.has(jti)) return false;
    const expiresAt = exp ? exp * 1000 : now + ImpersonationService.LINK_TTL_SECONDS * 1000;
    this.usedLinks.set(jti, expiresAt);
    return true;
  }

  /**
   * A 256-bit signature cannot be guessed, but a public endpoint that does
   * crypto per call still wants a ceiling. Sliding one-minute windows, in
   * memory — the same trade-off as the used-link list.
   */
  private throttle(ip: string | null): void {
    const now = Date.now();
    const windowStart = now - 60_000;
    let total = 0;
    for (const [key, stamps] of this.attempts) {
      const recent = stamps.filter((t) => t > windowStart);
      if (recent.length) {
        this.attempts.set(key, recent);
        total += recent.length;
      } else {
        this.attempts.delete(key);
      }
    }

    const key = ip || 'unknown';
    const mine = this.attempts.get(key) ?? [];
    if (mine.length >= ImpersonationService.PER_IP_LIMIT || total >= ImpersonationService.GLOBAL_LIMIT) {
      throw new HttpException('Too many attempts; try again in a minute', HttpStatus.TOO_MANY_REQUESTS);
    }
    mine.push(now);
    this.attempts.set(key, mine);
  }
}
