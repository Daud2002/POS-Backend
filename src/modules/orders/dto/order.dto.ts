import { IsNotEmpty, IsOptional, IsString, IsNumber, IsEnum, IsUUID, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsNull } from 'typeorm';

export class CreateOrderItemDto {
  @ApiProperty({ example: 'uuid', description: 'Product ID' })
  @IsNotEmpty()
  @IsString()
  productId: string;

  @ApiProperty({ example: 2, description: 'Quantity' })
  @IsNotEmpty()
  @IsNumber()
  quantity: number;

  @ApiProperty({ example: 999.99, description: 'Unit price' })
  @IsNotEmpty()
  @IsNumber()
  unitPrice: number;

  @ApiProperty({ example: 50, required: false, description: 'Discount amount for this item' })
  @IsOptional()
  @IsNumber()
  discount: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'uuid', required: false, description: 'Customer ID (link to existing customer)' })
  @IsOptional()
  @IsUUID()
  customerId: string;

  @ApiProperty({ type: [CreateOrderItemDto], description: 'Order items' })
  @IsNotEmpty()
  items: CreateOrderItemDto[];

  @ApiProperty({ example: 159.99, required: false, description: 'Tax amount' })
  @IsOptional()
  @IsNumber()
  tax: number;

  @ApiProperty({ example: 0, required: false, description: 'Discount amount' })
  @IsOptional()
  @IsNumber()
  discount: number;

  @ApiProperty({ example: 'Special order notes', required: false })
  @IsOptional()
  @IsString()
  notes: string;

  @ApiProperty({ example: 'cash', required: false, nullable: true, enum: ['cash', 'card', 'check', 'online'] })
  @IsOptional()
  @IsEnum(['cash', 'card', 'check', 'online'])
  paymentMethod: string;

  @ApiProperty({ example: 'unpaid', required: false, enum: ['pending', 'paid', 'unpaid', 'cancelled', 'refunded'] })
  @IsOptional()
  @IsEnum(['pending', 'paid', 'unpaid', 'cancelled', 'refunded'])
  status: string;

  @ApiProperty({ example: 12345, required: true })
  @IsNotEmpty()
  @IsNumber()
  total: number;
}

export class UpdateOrderDto {
  @ApiProperty({ example: 'paid', required: false, enum: ['pending', 'paid', 'unpaid', 'cancelled', 'refunded'] })
  @IsOptional()
  @IsEnum(['pending', 'paid', 'unpaid', 'cancelled', 'refunded'])
  status: string;

  @ApiProperty({ example: 159.99, required: false })
  @IsOptional()
  @IsNumber()
  tax: number;

  @ApiProperty({ example: 0, required: false })
  @IsOptional()
  @IsNumber()
  discount: number;

  @ApiProperty({ example: 'Updated notes', required: false })
  @IsOptional()
  @IsString()
  notes: string;

  @ApiProperty({ example: 'card', required: false, enum: ['cash', 'card', 'check', 'online'] })
  @IsOptional()
  @IsEnum(['cash', 'card', 'check', 'online'])
  paymentMethod: string;
}

export class OrderResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ORD-1629XXXXXX' })
  orderNumber: string;

  @ApiProperty({ example: 'paid', enum: ['pending', 'paid', 'unpaid', 'cancelled', 'refunded'] })
  status: string;


  @ApiProperty()
  customer?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
  };

  @ApiProperty({ example: 100 })
  subtotal: number;

  @ApiProperty({ example: 15 })
  tax: number;

  @ApiProperty({ example: 10 })
  discount: number;

  @ApiProperty({ example: 105 })
  total: number;

  @ApiProperty({ example: 'cash', enum: ['cash', 'card', 'check', 'online'] })
  paymentMethod: string;

  @ApiProperty()
  items: any[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
