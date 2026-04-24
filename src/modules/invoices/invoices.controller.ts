import {
  Controller,
  Get,
  Param,
  UseGuards,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, Employee } from '../../entities';

@ApiTags('Invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
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
  @Get(':orderId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate invoice data for an order' })
  @ApiResponse({
    status: 200,
    description: 'Invoice data successfully generated',
  })
  async generateInvoice(@Request() req: ExpressRequest, @Param('orderId') orderId: string) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.invoicesService.generateInvoiceData(orderId, storeId);
  }
}
