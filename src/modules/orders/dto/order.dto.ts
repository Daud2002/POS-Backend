import { IsNotEmpty, IsOptional, IsString, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
  @ApiProperty({ example: 'John Doe', required: false, description: 'Customer Name' })
  @IsOptional()
  @IsString()
  customerName: string;

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

  @ApiProperty({ example: 'cash', required: false, enum: ['cash', 'card', 'check', 'online'] })
  @IsOptional()
  @IsEnum(['cash', 'card', 'check', 'online'])
  paymentMethod: string;
}

export class UpdateOrderDto {
  @ApiProperty({ example: 'completed', required: false, enum: ['pending', 'completed', 'cancelled', 'refunded'] })
  @IsOptional()
  @IsEnum(['pending', 'completed', 'cancelled', 'refunded'])
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
