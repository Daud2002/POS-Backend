import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTableDto {
  @ApiProperty({ example: 'Table 5' })
  @IsNotEmpty()
  @IsString()
  name: string;
}

export class UpdateTableDto {
  @ApiPropertyOptional({ example: 'Patio 2' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Soft-delete flag. Tables are never hard-deleted.' })
  @IsOptional()
  isActive?: boolean;
}

export class RestaurantOrderItemDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ example: 'No onions', description: 'Kitchen instruction for this line' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateRestaurantOrderDto {
  @ApiProperty({ enum: ['dine_in', 'takeaway', 'delivery'] })
  @IsIn(['dine_in', 'takeaway', 'delivery'])
  orderType: 'dine_in' | 'takeaway' | 'delivery';

  @ApiPropertyOptional({ description: 'Required for dine_in. Ignored otherwise.' })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  /**
   * Nested validation is explicit here. The pre-existing CreateOrderDto omits
   * it, so item fields reach that service unchecked; this one rejects a
   * negative quantity instead of persisting it.
   */
  @ApiProperty({ type: [RestaurantOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestaurantOrderItemDto)
  items: RestaurantOrderItemDto[];

  @ApiPropertyOptional({ description: 'Save without sending to the kitchen. Does not reserve a table.' })
  @IsOptional()
  isDraft?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({ description: 'Required for delivery.' })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDraftOrderDto {
  @ApiProperty({ type: [RestaurantOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestaurantOrderItemDto)
  items: RestaurantOrderItemDto[];

  @ApiPropertyOptional({ description: 'Intended table. A draft never reserves it.' })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  /**
   * Optimistic lock. Drafts are shared between waiters, so a stale write must
   * fail loudly rather than silently discard the other waiter's lines.
   */
  @ApiPropertyOptional({ description: 'Version the client last read. Mismatch returns 409.' })
  @IsOptional()
  @IsNumber()
  version?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddOrderItemsDto {
  @ApiProperty({ type: [RestaurantOrderItemDto], description: 'An additional round for a live order.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestaurantOrderItemDto)
  items: RestaurantOrderItemDto[];
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ['preparing', 'completed'] })
  @IsIn(['preparing', 'completed'])
  orderStatus: 'preparing' | 'completed';
}

export class SettleOrderDto {
  @ApiPropertyOptional({ enum: ['amount', 'percent'] })
  @IsOptional()
  @IsIn(['amount', 'percent'])
  discountType?: 'amount' | 'percent';

  @ApiPropertyOptional({ example: 250, description: 'Raw figure: 250 for flat, 25 for 25%.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({ enum: ['cash', 'card', 'check', 'online'] })
  @IsOptional()
  @IsIn(['cash', 'card', 'check', 'online'])
  paymentMethod?: string;
}
