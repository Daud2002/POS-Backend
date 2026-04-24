import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto, MarkAsPaidDto } from './dto/order.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, Employee } from '../../entities';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
  ) {}

  private async getStoreIdFromUser(user: any): Promise<string | undefined> {
    if (user.role === 'admin') {
      return undefined;
    } else if (user.role === 'store_owner') {
      const store = await this.storesRepository.findOne({ where: { userId: user.id } });
      if (!store) throw new BadRequestException('Store not found for this user');
      return store.id;
    } else if (user.role === 'employee' || user.role === 'cashier') {
      const employee = await this.employeesRepository.findOne({ where: { userId: user.id } });
      if (!employee) throw new BadRequestException('Employee record not found');
      return employee.storeId;
    }
    throw new BadRequestException('Invalid user role for this operation');
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new order' })
  async create(@Body() createOrderDto: CreateOrderDto, @Request() req: ExpressRequest) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.create(createOrderDto, (req.user as any).id, storeId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all orders for store' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  async findAll(
    @Request() req: ExpressRequest,
    @Query('skip') skip?: number,
    @Query('take') take?: number,
    @Query('customerId') customerId?: string,
  ) {
    const storeId = await this.getStoreIdFromUser(req.user);
    if (customerId) {
      return this.ordersService.findByCustomer(customerId, storeId);
    }
    return this.ordersService.findAll(storeId, skip, take);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('customer/:customerId')
  @ApiBearerAuth()
  @ApiQuery({ name: 'storeId', required: true, type: String })
  async findByCustomer(@Request() req: ExpressRequest, @Param('customerId') customerId: string) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.findByCustomer(customerId, storeId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an order' })
  async update(
    @Request() req: ExpressRequest,
    @Param('id') id: string,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.update(id, updateOrderDto, storeId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/mark-as-paid')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark an order as paid' })
  async markAsPaid(
    @Request() req: ExpressRequest,
    @Param('id') id: string,
    @Body() markAsPaidDto: MarkAsPaidDto,
  ) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.markAsPaid(id, storeId, markAsPaidDto.paymentMethod);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an order' })
  async remove(@Request() req: ExpressRequest, @Param('id') id: string) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.remove(id, storeId);
  }
}
