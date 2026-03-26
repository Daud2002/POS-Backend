import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';

@ApiTags('Employees')
@Controller('employees')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  @Get('store/:storeId')
  @ApiOperation({ summary: 'Get all employees for a store' })
  @ApiResponse({ status: 200, description: 'List of employees' })
  async getStoreEmployees(
    @Param('storeId') storeId: string,
    @Query('skip') skip: number = 0,
    @Query('take') take: number = 10,
  ) {
    return this.employeesService.findAll(storeId, skip, take);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get employee by ID' })
  @ApiResponse({ status: 200, description: 'Employee details' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async getEmployee(@Param('id') id: string) {
    return this.employeesService.findOne(id);
  }

  @Post('store/:storeId')
  @ApiOperation({ summary: 'Create new employee for a store' })
  @ApiResponse({ status: 201, description: 'Employee created successfully' })
  async createEmployee(
    @Param('storeId') storeId: string,
    @Body() createEmployeeDto: CreateEmployeeDto,
  ) {
    return this.employeesService.create(storeId, createEmployeeDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee' })
  @ApiResponse({ status: 200, description: 'Employee updated successfully' })
  async updateEmployee(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(id, updateEmployeeDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete employee' })
  @ApiResponse({ status: 200, description: 'Employee deleted successfully' })
  async deleteEmployee(@Param('id') id: string) {
    return this.employeesService.delete(id);
  }
}
