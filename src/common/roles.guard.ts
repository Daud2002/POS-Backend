import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './decorators';
import { EffectiveRole, resolveEffectiveRole } from './roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<EffectiveRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() on the route: this guard has no opinion. Authentication is
    // JwtAuthGuard's job.
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Not authenticated');

    // Recompute rather than trusting a client-supplied field. `user` comes
    // from JwtStrategy.validate(), which re-reads the row on every request.
    const effectiveRole = user.effectiveRole ?? resolveEffectiveRole(user);

    if (!required.includes(effectiveRole)) {
      throw new ForbiddenException('You do not have access to this resource');
    }

    return true;
  }
}
