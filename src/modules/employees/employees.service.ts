import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from '@/entities';
import { User } from '@/entities';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async findAll(storeId: string, skip = 0, take = 10) {
    return await this.employeesRepository.find({
      where: { storeId },
      skip,
      take,
      order: { createdAt: 'DESC' },
      relations: ['user', 'store'],
    });
  }

  async findOne(id: string) {
    return await this.employeesRepository.findOne({
      where: { id },
      relations: ['user', 'store'],
    });
  }

  async findByStoreAndEmployeeId(storeId: string, employeeId: string) {
    return await this.employeesRepository.findOne({
      where: { storeId, employeeId },
      relations: ['user', 'store'],
    });
  }

  async create(storeId: string, createEmployeeDto: CreateEmployeeDto) {
    // Check if email already exists
    const existingUser = await this.usersRepository.findOne({
      where: { email: createEmployeeDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // Check if employee ID already exists in this store
    const existingEmployee = await this.employeesRepository.findOne({
      where: { storeId, employeeId: createEmployeeDto.employeeId },
    });

    if (existingEmployee) {
      throw new ConflictException('Employee ID already exists in this store');
    }

    // Create user for employee
    const hashedPassword = await bcrypt.hash(createEmployeeDto.password, 10);
    const user = this.usersRepository.create({
      email: createEmployeeDto.email,
      passwordHash: hashedPassword,
      name: createEmployeeDto.name,
      phone: createEmployeeDto.phone,
      role: 'employee' as any,
      isActive: createEmployeeDto.isActive ?? true,
    });

    const savedUser = await this.usersRepository.save(user);

    // Create employee record
    const employee = this.employeesRepository.create({
      ...createEmployeeDto,
      storeId,
      userId: savedUser.id,
    });

    // Remove password and isActive from the DTO before saving to employee table
    delete (employee as any).password;
    delete (employee as any).isActive;

    return await this.employeesRepository.save(employee);
  }

  async update(id: string, updateEmployeeDto: UpdateEmployeeDto) {
    const employee = await this.employeesRepository.findOne({ where: { id } });
    
    if (!employee) {
      throw new BadRequestException(`Employee with ID ${id} not found`);
    }

    // If email is being updated, check for conflicts
    if (updateEmployeeDto.email && updateEmployeeDto.email !== employee.email) {
      const existingUser = await this.usersRepository.findOne({
        where: { email: updateEmployeeDto.email },
      });
      if (existingUser) {
        throw new ConflictException('Email already exists');
      }
    }

    // If password is being updated, hash it
    if (updateEmployeeDto.password) {
      const hashedPassword = await bcrypt.hash(updateEmployeeDto.password, 10);
      await this.usersRepository.update(employee.userId, {
        passwordHash: hashedPassword,
      });
    }

    // If isActive is being updated, update the User table
    if (updateEmployeeDto.isActive !== undefined) {
      await this.usersRepository.update(employee.userId, {
        isActive: updateEmployeeDto.isActive,
      });
    }

    // Update employee record (exclude password from employee table update)
    const { password, isActive, ...updateData } = updateEmployeeDto;

    Object.assign(employee, updateData);
    return await this.employeesRepository.save(employee);
  }

  async delete(id: string) {
    const employee = await this.employeesRepository.findOne({ where: { id } });
    
    if (!employee) {
      throw new BadRequestException(`Employee with ID ${id} not found`);
    }

    // Delete the associated user
    if (employee.userId) {
      await this.usersRepository.delete(employee.userId);
    }

    await this.employeesRepository.delete(id);
    return { message: 'Employee and associated user deleted successfully' };
  }
}
