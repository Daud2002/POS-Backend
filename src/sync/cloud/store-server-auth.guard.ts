import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { StoreServer } from '../../entities';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Authenticates a store server: `Authorization: StoreServer <id>.<secret>`.
 *
 * The secret is handed out once, at pairing, and only its hash is kept here.
 * A revoked server is refused outright; a fenced one (replaced by a failover)
 * still gets in, because it must be able to hand back what it holds.
 */
@Injectable()
export class StoreServerAuthGuard implements CanActivate {
  constructor(@InjectRepository(StoreServer) private readonly servers: Repository<StoreServer>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const match = /^StoreServer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Store server credential required');

    const server = await this.servers.findOne({ where: { id: match[1] } });
    const given = Buffer.from(sha256(match[2]), 'hex');
    const stored = Buffer.from(server?.credentialHash ?? '0'.repeat(64), 'hex');
    if (!server || server.status === 'revoked' || !timingSafeEqual(given, stored)) {
      throw new UnauthorizedException('Unknown or revoked store server');
    }

    req.storeServer = server;
    return true;
  }
}
