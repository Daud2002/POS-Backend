import { Injectable } from '@nestjs/common';
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
    
    if (user.role === 'store_owner') {
      const store = await this.storesRepository.findOne({ where: { userId: user.id } });
      storeId = store?.id;
    } else if (user.role === 'employee' || user.role === 'cashier') {
      const employee = await this.employeesRepository.findOne({ where: { userId: user.id } });
      storeId = employee?.storeId;
    }
    
    return { ...user, storeId };
  }

  async login(user: any) {
    const userWithStore = await this.getUserWithStore(user);
    const payload = { email: user.email, sub: user.id, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload),
      user: userWithStore,
    };
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
