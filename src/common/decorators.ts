import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { EffectiveRole } from './roles';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given effective roles.
 *
 * Must be combined with JwtAuthGuard — RolesGuard only inspects `req.user`,
 * it does not authenticate:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('restaurant_owner')
 */
export const Roles = (...roles: EffectiveRole[]) => SetMetadata(ROLES_KEY, roles);

/** The authenticated user, as assembled by AuthService.getUserWithStore(). */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest().user;
    return data ? user?.[data] : user;
  },
);
