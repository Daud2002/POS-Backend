import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
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

  /**
   * Pack this line to take away, on a `dine_out` order that is otherwise eaten
   * at the table. MUST be declared here: the global ValidationPipe runs with
   * `whitelist: true`, so an undeclared field is silently dropped and the
   * kitchen would never learn to box anything.
   */
  @ApiPropertyOptional({
    example: false,
    description: 'Pack this line to go as a parcel. Any parcel line makes a table order dine_out.',
  })
  @IsOptional()
  @IsBoolean()
  isParcel?: boolean;
}

export class CreateRestaurantOrderDto {
  @ApiProperty({
    enum: ['dine_in', 'dine_out', 'takeaway', 'delivery'],
    description:
      'dine_out = a table order with one or more parcel lines (shown to people as Parcel or Dine-in + Parcel); it occupies a table like dine_in. Derived from the lines server-side.',
  })
  @IsIn(['dine_in', 'dine_out', 'takeaway', 'delivery'])
  orderType: 'dine_in' | 'dine_out' | 'takeaway' | 'delivery';

  @ApiPropertyOptional({
    description: 'Required for dine_in and dine_out. Ignored for takeaway/delivery.',
  })
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

  /**
   * The cashier enters the discount and the delivery charge while punching
   * the order, so the bill that prints as it is sent is already right. All
   * three must be declared here or `whitelist: true` drops them silently.
   */
  @ApiPropertyOptional({ enum: ['amount', 'percent'] })
  @IsOptional()
  @IsIn(['amount', 'percent'])
  discountType?: 'amount' | 'percent';

  @ApiPropertyOptional({ example: 250, description: 'Raw figure: 250 for flat, 25 for 25%.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Delivery charge for this order. Ignored (stored as 0) unless orderType is delivery.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryCharge?: number;

  /**
   * Print the bill as part of creating the order. Cashiers and owners only:
   * printing claims the order for the printer, and a waiter must never hold
   * a claim. Ignored on drafts.
   */
  @ApiPropertyOptional({
    description:
      'Record the bill as printed at creation (the till prints it from the response). Cashier/owner only; ignored on drafts.',
  })
  @IsOptional()
  @IsBoolean()
  printBill?: boolean;
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

  @ApiPropertyOptional({
    default: true,
    description:
      "false = the cashier's \"Print bill & update\": the new lines are billed but never reach the kitchen. Honoured for cashier, supervisor and owner only; a waiter's round always goes to the kitchen.",
  })
  @IsOptional()
  @IsBoolean()
  sendToKitchen?: boolean;
}

export class RemoveOrderItemDto {
  @ApiProperty({ description: 'The order_items.id to take off.' })
  @IsUUID()
  orderItemId: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'How many to remove. Omit to remove the whole line.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

/**
 * Taking items OFF a live order — by a waiter at the table or a cashier at the
 * till. The bill is reprinted afterwards, and the kitchen gets a cancellation
 * ticket for anything it had not yet handed over.
 */
export class RemoveOrderItemsDto {
  @ApiProperty({ type: [RemoveOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemoveOrderItemDto)
  items: RemoveOrderItemDto[];

  @ApiPropertyOptional({
    default: true,
    description:
      'false = no cancellation ticket for the kitchen. Honoured for cashier, supervisor and owner only.',
  })
  @IsOptional()
  @IsBoolean()
  sendToKitchen?: boolean;
}

/**
 * What the KITCHEN may set.
 *
 * 'completed' is deliberately absent: it means "paid and the table is free",
 * which only the cashier's settle() may do. Allowing it here let the kitchen
 * strand a table forever and book unpaid orders as revenue.
 */
export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: ['preparing', 'handed_over'],
    description: 'handed_over = cooked and passed to the floor; still unpaid.',
  })
  @IsIn(['preparing', 'handed_over'])
  orderStatus: 'preparing' | 'handed_over';
}

/**
 * Printing (or reprinting) the bill — the step BEFORE money changes hands.
 *
 * Every money field here is "absent = keep what is stored, null = clear it".
 * A cashier-punched order already carries its discount and delivery charge
 * from creation, and a reprint after a lost slip must not wipe them just
 * because the client sent an empty body — which is exactly what an older
 * mobile build does.
 */
export class PrintBillDto {
  @ApiPropertyOptional({
    enum: ['amount', 'percent'],
    nullable: true,
    description: 'Omit to keep the stored discount; send null to remove it.',
  })
  @ValidateIf((o) => o.discountType !== undefined && o.discountType !== null)
  @IsIn(['amount', 'percent'])
  discountType?: 'amount' | 'percent' | null;

  @ApiPropertyOptional({
    example: 250,
    nullable: true,
    description: 'Raw figure: 250 for flat, 25 for 25%. Omit to keep; null to clear.',
  })
  @ValidateIf((o) => o.discountValue !== undefined && o.discountValue !== null)
  @IsNumber()
  @Min(0)
  discountValue?: number | null;

  @ApiPropertyOptional({
    example: 0,
    nullable: true,
    description: 'Delivery charge. Omit to keep the stored one; only meaningful on a delivery.',
  })
  @ValidateIf((o) => o.deliveryCharge !== undefined && o.deliveryCharge !== null)
  @IsNumber()
  @Min(0)
  deliveryCharge?: number | null;

  /** LEGACY. No longer required or printed; accepted so older tills do not 400. */
  @ApiPropertyOptional({ deprecated: true, description: 'Ignored. Kept for older clients.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  riderName?: string;
}

/** How a partial payment was split. Amounts, not percentages; must sum to the total. */
export class PaymentSplitDto {
  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cash?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  card?: number;

  @ApiPropertyOptional({ example: 150 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  online?: number;
}

/**
 * A tip left on top of the bill, on either way of taking money.
 *
 * The till works out the tip (what it received minus the bill) and sends it
 * explicitly; the split, if any, still adds up to the bill alone. Stores that
 * do not record tips never send these, and an absent tip is always accepted.
 */
export class TipFieldsDto {
  @ApiPropertyOptional({
    example: 150,
    description: 'Tip on top of the bill. Never part of the total, the split, or revenue.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  // The column is decimal(10,2); anything larger would surface as a 500.
  @Max(99999999.99)
  tipAmount?: number;

  @ApiPropertyOptional({
    enum: ['cash', 'card', 'online'],
    description:
      'How the tip was paid. Defaults to the payment method when that is cash, card or online; required on a split.',
  })
  @IsOptional()
  @IsIn(['cash', 'card', 'online'])
  tipMethod?: 'cash' | 'card' | 'online';

  @ApiPropertyOptional({
    example: 1850,
    description:
      'The bill the cashier was shown. When sent and it is not the total being charged, the payment is refused (409) rather than recording a wrong tip.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedTotal?: number;
}

/**
 * Taking the money. The bill must already have been printed, at any till.
 *
 * The discount fields are accepted for older clients that still settle in one
 * step; a client built for the print-then-pay flow omits them and the figure
 * fixed at print time is charged.
 */
export class SettleOrderDto extends TipFieldsDto {
  @ApiPropertyOptional({ enum: ['amount', 'percent'] })
  @IsOptional()
  @IsIn(['amount', 'percent'])
  discountType?: 'amount' | 'percent';

  @ApiPropertyOptional({ example: 250, description: 'Raw figure: 250 for flat, 25 for 25%.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({
    enum: ['cash', 'card', 'check', 'online', 'partial'],
    description: "'partial' = more than one method; send the amounts in `split`.",
  })
  @IsOptional()
  @IsIn(['cash', 'card', 'check', 'online', 'partial'])
  paymentMethod?: string;

  @ApiPropertyOptional({
    type: PaymentSplitDto,
    description: 'Required with paymentMethod=partial. Must add up to the printed total.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentSplitDto)
  split?: PaymentSplitDto;
}

/**
 * Putting an order on credit: the customer walks away owing.
 *
 * Name a customer either way:
 * - `customerId` — one already in the store's directory (the till found them
 *   through /customers/suggest);
 * - `customerName` + `customerPhone` — a new one, filed by phone (an existing
 *   customer with that phone is reused). A cashier cannot create customers
 *   through /customers, so this is how a first-time credit customer is added.
 *
 * The money fields follow printBill's "absent = keep, null = clear" and only
 * apply when the bill has NOT been printed; a printed bill's figures win, as
 * they do in settle.
 */
export class CreditOrderDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 'Ahmed Khan' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @ApiPropertyOptional({ example: '03001234567', description: 'Required when no customerId is sent.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerPhone?: string;

  @ApiPropertyOptional({ enum: ['amount', 'percent'], nullable: true })
  @ValidateIf((o) => o.discountType !== undefined && o.discountType !== null)
  @IsIn(['amount', 'percent'])
  discountType?: 'amount' | 'percent' | null;

  @ApiPropertyOptional({ example: 250, nullable: true })
  @ValidateIf((o) => o.discountValue !== undefined && o.discountValue !== null)
  @IsNumber()
  @Min(0)
  discountValue?: number | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  @ValidateIf((o) => o.deliveryCharge !== undefined && o.deliveryCharge !== null)
  @IsNumber()
  @Min(0)
  deliveryCharge?: number | null;
}

/** Collecting a credit order: how the customer paid. The amount is the order's total. */
export class SettleCreditDto extends TipFieldsDto {
  @ApiPropertyOptional({
    enum: ['cash', 'card', 'online', 'partial'],
    description: "'partial' = more than one method; send the amounts in `split`.",
  })
  @IsOptional()
  @IsIn(['cash', 'card', 'online', 'partial'])
  paymentMethod?: string;

  @ApiPropertyOptional({
    type: PaymentSplitDto,
    description: 'Required with paymentMethod=partial. Must add up to the order total.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentSplitDto)
  split?: PaymentSplitDto;
}
