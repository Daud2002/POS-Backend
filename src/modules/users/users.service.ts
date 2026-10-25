import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { Employee } from '../../entities/employee.entity';
import { CreateUserDto, UpdateUserDto, UserRole } from './dto';
import * as bcrypt from 'bcryptjs';
import { toPage, type Page } from '../../common/pagination';
import { RefreshTokenService } from '../../auth/refresh-token.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
    private refreshTokenService: RefreshTokenService,
    private realtime: RealtimeGateway,
  ) {}

  /** Strips the credential before a user ever reaches a response body. */
  private sanitize<T extends User | null>(user: T): T {
    if (!user) return user;
    const { passwordHash, ...safe } = user;
    return safe as T;
  }

  async findAll(role?: UserRole) {
    const users = await this.usersRepository.find(
      role ? { where: { role } } : undefined,
    );
    return users.map((u) => this.sanitize(u));
  }

  async findAllPaged(role: UserRole | undefined, skip: number, take: number): Promise<Page<User>> {
    const [items, total] = await this.usersRepository.findAndCount({
      ...(role ? { where: { role } } : {}),
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
    return toPage(items.map((u) => this.sanitize(u)), total, skip, take);
  }

  async findOne(id: string) {
    return this.sanitize(await this.usersRepository.findOne({ where: { id } }));
  }

  async create(createUserDto: CreateUserDto) {
    const { password, ...rest } = createUserDto;
    const user = this.usersRepository.create({
      ...rest,
      // Same cost factor as AuthService. This previously stored the password
      // verbatim, which both left it in plaintext and made the account
      // impossible to log into, since login does a bcrypt compare.
      passwordHash: await bcrypt.hash(password, 10),
    });
    return this.sanitize(await this.usersRepository.save(user));
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const { password, ...rest } = updateUserDto;
    const updateData: any = { ...rest };
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }
    await this.usersRepository.update(id, updateData);
    if (rest.isActive === false) {
      await this.endSessions(id);
    }
    return this.findOne(id);
  }

  /**
   * Signs a deactivated account out everywhere and, for a store owner, every
   * member of their staff with it — deactivating the owner is how the
   * dashboard deactivates a store.
   *
   * The auth checks would refuse these sessions on their next request anyway.
   * This makes it immediate, and revoking the refresh tokens means
   * reactivating the store later does not quietly revive old sessions.
   */
  private async endSessions(userId: string) {
    const staff = await this.employeesRepository
      .createQueryBuilder('employee')
      .innerJoin('employee.store', 'store')
      .where('store.userId = :userId', { userId })
      .select('employee.userId', 'userId')
      .getRawMany<{ userId: string | null }>();

    const userIds = [userId, ...staff.map((row) => row.userId).filter((id): id is string => !!id)];
    await this.refreshTokenService.revokeAllForUsers(userIds);
    await this.realtime.signOutUsers(userIds);
  }

  async remove(id: string) {
    await this.usersRepository.delete(id);
    return { deleted: true };
  }
}
