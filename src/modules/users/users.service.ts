import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { CreateUserDto, UpdateUserDto, UserRole } from './dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  findAll(role?: UserRole) {
    if (role) {
      return this.usersRepository.find({ where: { role } });
    }
    return this.usersRepository.find();
  }

  findOne(id: string) {
    return this.usersRepository.findOne({ where: { id } });
  }

  async create(createUserDto: CreateUserDto) {
    // Map password to passwordHash
    const { password, ...rest } = createUserDto;
    const user = this.usersRepository.create({
      ...rest,
      passwordHash: password,
    });
    return this.usersRepository.save(user);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const { password, ...rest } = updateUserDto;
    const updateData: any = { ...rest };
    if (password) {
      updateData.passwordHash = password;
    }
    const changed = await this.usersRepository.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.usersRepository.delete(id);
    return { deleted: true };
  }
}
