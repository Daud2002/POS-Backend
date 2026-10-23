import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ImpersonationService, IMPERSONATION_LINK_TYPE } from './impersonation.service';
import { AuthService } from './auth.service';

const SECRET = 'impersonation-secret-with-at-least-32-chars';
const JWT_SECRET = 'ordinary-access-token-secret';

const admin = { id: 'admin-1', name: 'Daud', role: 'admin' };
const owner = { id: 'owner-1', name: 'Owner', email: 'owner@x.com', role: 'store_owner', isActive: true };

function setup(options: { secret?: string | null; inactive?: string | null } = {}) {
  const jwt = new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: '30m' } });
  const users = {
    findOne: jest.fn(async ({ where }: any) => {
      if (where.id === owner.id) return { ...owner };
      if (where.id === admin.id) return { ...admin };
      return null;
    }),
  };
  const auth = {
    inactiveReason: jest.fn(async () => options.inactive ?? null),
    getUserWithStore: jest.fn(async (user: any) => ({
      ...user,
      storeId: 'store-1',
      storeName: 'Snack Fuel',
      effectiveRole: 'restaurant_owner',
    })),
    describeImpersonator: jest.fn(async () => ({ id: admin.id, name: admin.name })),
    impersonate: jest.fn(async (user: any, who: any) => ({
      accessToken: 'access',
      refreshToken: null as string | null,
      user: { ...user, storeId: 'store-1', storeName: 'Snack Fuel', impersonatedBy: who },
    })),
  };
  const config = {
    get: jest.fn((key: string) => (key === 'IMPERSONATION_SECRET' ? (options.secret === undefined ? SECRET : options.secret) : undefined)),
  };
  const audit = { log: jest.fn(async (_entry: unknown): Promise<void> => undefined) };
  const service = new ImpersonationService(users as any, jwt, config as any, auth as any, audit as any);
  return { service, jwt, users, auth, audit };
}

describe('ImpersonationService', () => {
  it('answers 503 until a secret is configured', async () => {
    const { service } = setup({ secret: null });
    await expect(service.issueLink(admin, owner.id)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.exchange('anything')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(service.isConfigured()).toBe(false);
  });

  it('treats a short secret as unset', () => {
    const { service } = setup({ secret: 'short' });
    expect(service.isConfigured()).toBe(false);
  });

  it('refuses admins, yourself and inactive accounts', async () => {
    const { service } = setup();
    await expect(service.issueLink(admin, admin.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.issueLink({ id: owner.id }, owner.id)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.issueLink(admin, 'nobody')).rejects.toThrow('User not found');

    const { service: inactive } = setup({ inactive: 'Your account is inactive.' });
    await expect(inactive.issueLink(admin, owner.id)).rejects.toThrow('Your account is inactive.');
  });

  it('issues a link that names the target, the admin and an hour-long expiry', async () => {
    const { service, jwt } = setup();

    const link = await service.issueLink(admin, owner.id);

    const payload = jwt.verify(link.token, { secret: SECRET }) as any;
    expect(payload).toMatchObject({ sub: owner.id, adm: admin.id, typ: IMPERSONATION_LINK_TYPE });
    expect(payload.jti).toHaveLength(36);
    expect(payload.exp - payload.iat).toBe(3600);
    expect(link.target).toEqual({
      id: owner.id,
      name: 'Owner',
      email: 'owner@x.com',
      role: 'restaurant_owner',
      storeId: 'store-1',
      storeName: 'Snack Fuel',
    });
    // The link is useless as an access token: it is not signed with JWT_SECRET.
    expect(() => jwt.verify(link.token)).toThrow();
  });

  it('exchanges a link exactly once and records who did it', async () => {
    const { service, auth, audit } = setup();
    const { token } = await service.issueLink(admin, owner.id);

    const session = await service.exchange(token, { ip: '1.2.3.4', userAgent: 'jest' });

    expect(session.refreshToken).toBeNull();
    expect(session.user.impersonatedBy).toEqual({ id: admin.id, name: admin.name });
    expect(auth.impersonate).toHaveBeenCalledWith(
      expect.objectContaining({ id: owner.id }),
      { id: admin.id, name: admin.name },
      'jest',
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'impersonation.started',
        actorId: admin.id,
        impersonatorId: admin.id,
        storeId: 'store-1',
        ip: '1.2.3.4',
        summary: "Daud opened Owner's account (Snack Fuel)",
      }),
    );

    await expect(service.exchange(token)).rejects.toThrow('This link has already been used');
  });

  it('rejects links signed with another secret, expired links and access tokens', async () => {
    const { service, jwt } = setup();

    const forged = jwt.sign({ sub: owner.id, adm: admin.id, typ: IMPERSONATION_LINK_TYPE, jti: 'x' }, { secret: 'another-secret-that-is-long-enough-too' });
    await expect(service.exchange(forged)).rejects.toBeInstanceOf(UnauthorizedException);

    const expired = jwt.sign(
      { sub: owner.id, adm: admin.id, typ: IMPERSONATION_LINK_TYPE, jti: 'y' },
      { secret: SECRET, expiresIn: -60 },
    );
    await expect(service.exchange(expired)).rejects.toThrow('This link is invalid or has expired');

    // Signed with the right secret but not a link.
    const accessShaped = jwt.sign({ sub: owner.id, email: owner.email, role: owner.role }, { secret: SECRET });
    await expect(service.exchange(accessShaped)).rejects.toThrow('This link is invalid or has expired');
  });

  it('refuses an account that was deactivated after the link was made', async () => {
    const { service, auth } = setup();
    const { token } = await service.issueLink(admin, owner.id);
    auth.inactiveReason.mockResolvedValueOnce('This store has been deactivated.');

    await expect(service.exchange(token)).rejects.toThrow('This store has been deactivated.');
  });

  it('rate-limits exchange attempts per address', async () => {
    const { service } = setup();
    for (let i = 0; i < ImpersonationService.PER_IP_LIMIT; i += 1) {
      await expect(service.exchange('garbage', { ip: '9.9.9.9' })).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(service.exchange('garbage', { ip: '9.9.9.9' })).rejects.toMatchObject({ status: 429 });
    await expect(service.exchange('garbage', { ip: '8.8.8.8' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.exchange('garbage', { ip: '9.9.9.9' })).rejects.toBeInstanceOf(HttpException);
  });
});

describe('AuthService.impersonate', () => {
  function setup() {
    const jwt = new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: '30m' } });
    const stores = { findOne: jest.fn(async () => ({ id: 'store-1', name: 'Snack Fuel', currency: 'PKR', accountType: 'restaurant', subscriptionExpiresAt: '2027-01-21' })) };
    const refreshTokens = { issue: jest.fn() };
    const service = new AuthService({} as any, stores as any, {} as any, jwt, refreshTokens as any);
    return { service, jwt, refreshTokens };
  }

  it('issues a one-hour access token marked with the admin and no refresh token', async () => {
    const { service, jwt, refreshTokens } = setup();

    const session = await service.impersonate(
      { ...owner, passwordHash: 'hash' } as any,
      { id: admin.id, name: admin.name },
      'jest',
    );

    const payload = jwt.verify(session.accessToken) as any;
    expect(payload).toMatchObject({ sub: owner.id, email: owner.email, role: owner.role, imp: admin.id });
    expect(payload.exp - payload.iat).toBe(3600);
    expect(session.refreshToken).toBeNull();
    expect(refreshTokens.issue).not.toHaveBeenCalled();
    expect(session.user.impersonatedBy).toEqual({ id: admin.id, name: admin.name });
    expect(session.user.subscriptionExpiresAt).toBe('2027-01-21');
    expect(session.user.passwordHash).toBeUndefined();
  });

  it('signs ordinary logins without the marker and at the default lifetime', async () => {
    const { service, jwt, refreshTokens } = setup();
    refreshTokens.issue.mockResolvedValue('refresh');

    const session = await service.login({ ...owner } as any, 'jest');

    const payload = jwt.verify(session.accessToken) as any;
    expect(payload.imp).toBeUndefined();
    expect(payload.exp - payload.iat).toBe(1800);
    expect(session.refreshToken).toBe('refresh');
  });
});
