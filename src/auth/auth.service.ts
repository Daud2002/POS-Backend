import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User, Store, Employee } from '../entities';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (user && (await bcrypt.compare(password, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async getUserWithStore(user: any) {
    let storeId: string | undefined;
    let currency: string | undefined;
    let printerConfig: string | undefined;

    if (user.role === 'store_owner') {
      const store = await this.storesRepository.findOne({ where: { userId: user.id } });
      storeId = store?.id;
      currency = store?.currency;
      printerConfig = store?.printerConfig;
    } else if (user.role === 'employee' || user.role === 'cashier') {
      const employee = await this.employeesRepository.findOne({ where: { userId: user.id } });
      storeId = employee?.storeId;
      if (storeId) {
        const store = await this.storesRepository.findOne({ where: { id: storeId } });
        currency = store?.currency;
        printerConfig = store?.printerConfig;
      }
    }

    return { ...user, storeId, currency, printerConfig };
  }

  async login(user: any) {
    const userWithStore = await this.getUserWithStore(user);
    const payload = { email: user.email, sub: user.id, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload),
      user: userWithStore,
    };
  }

  /**
   * Changes a signed-in user's own password.
   *
   * Note: JWTs carry no `jti` or password version, so tokens issued before the
   * change stay valid. That is consistent with the existing no-refresh-token
   * design; invalidating other sessions would need a token-version column.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from the current one');
    }

    // Same cost factor as register().
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.save(user);

    // Deliberately does not echo the user entity — getUserWithStore already
    // leaks passwordHash on /auth/me; don't add a second place it can escape.
    return { message: 'Password updated successfully' };
  }

  async register(email: string, password: string, name: string) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.usersRepository.create({
      email,
      passwordHash: hashedPassword,
      name,
      role: 'employee' as any,
    });
    return await this.usersRepository.save(user);
  }
}
