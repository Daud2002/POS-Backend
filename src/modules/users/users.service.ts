import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { CreateUserDto, UpdateUserDto, UserRole } from './dto';
import * as bcrypt from 'bcrypt';
import { toPage, type Page } from '../../common/pagination';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
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
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.usersRepository.delete(id);
    return { deleted: true };
  }
}
