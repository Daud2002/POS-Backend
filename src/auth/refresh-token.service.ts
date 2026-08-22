import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { RefreshToken } from '../entities';

/** Days a login stays alive. Rotation never extends this. */
const DEFAULT_TTL_DAYS = 7;

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private refreshTokensRepository: Repository<RefreshToken>,
    private configService: ConfigService,
  ) {}

  private get ttlDays(): number {
    return Number(this.configService.get('REFRESH_TOKEN_TTL_DAYS', DEFAULT_TTL_DAYS));
  }

  /**
   * SHA-256 rather than bcrypt: the token is 256 bits of CSPRNG output, so it
   * has no guessable structure for bcrypt's work factor to protect. Refresh is
   * also on the hot path for every expiring session, and we need to *look the
   * token up* by hash — which a per-row bcrypt salt makes impossible.
   */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private expiryDate(): Date {
    return new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000);
  }

  /** Issues the first token of a new family (i.e. a fresh login). */
  async issue(userId: string, userAgent?: string): Promise<string> {
    return this.persist(userId, randomUUID(), this.expiryDate(), userAgent);
  }

  private async persist(
    userId: string,
    familyId: string,
    expiresAt: Date,
    userAgent?: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');

    await this.refreshTokensRepository.save(
      this.refreshTokensRepository.create({
        userId,
        familyId,
        tokenHash: this.hash(token),
        expiresAt,
        userAgent: userAgent?.slice(0, 255),
      }),
    );

    return token;
  }

  /**
   * Validates a refresh token and rotates it.
   *
   * Returns the new token plus the owning userId. Throws for anything that
   * isn't a live, unexpired, never-before-rotated token.
   */
  async rotate(
    token: string,
    userAgent?: string,
  ): Promise<{ token: string; userId: string }> {
    const existing = await this.refreshTokensRepository.findOne({
      where: { tokenHash: this.hash(token) },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Already rotated => this token was captured and replayed. The legitimate
    // holder has a newer token, so burning the family logs the attacker out
    // along with the victim, who simply signs in again.
    if (existing.replacedById || existing.revokedAt) {
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException('Refresh token already used');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Carry the ORIGINAL expiry forward so a busy session cannot refresh its
    // way past the 7-day cap.
    const next = await this.persist(
      existing.userId,
      existing.familyId,
      existing.expiresAt,
      userAgent,
    );

    const nextRow = await this.refreshTokensRepository.findOne({
      where: { tokenHash: this.hash(next) },
    });

    existing.replacedById = nextRow?.id;
    existing.revokedAt = new Date();
    await this.refreshTokensRepository.save(existing);

    return { token: next, userId: existing.userId };
  }

  /** Logout. Revokes every token descended from the same login. */
  async revokeByToken(token: string): Promise<void> {
    const existing = await this.refreshTokensRepository.findOne({
      where: { tokenHash: this.hash(token) },
    });
    if (existing) {
      await this.revokeFamily(existing.familyId);
    }
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokensRepository.update(
      // IsNull(), not `null`: a plain null renders as `revokedAt = NULL`,
      // which is never true in SQL, so the revoke would silently match no rows.
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Used when an account is deactivated or its password changes. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokensRepository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Housekeeping so the table doesn't grow without bound. */
  async purgeExpired(): Promise<void> {
    await this.refreshTokensRepository.delete({
      expiresAt: LessThan(new Date()),
    });
  }
}
