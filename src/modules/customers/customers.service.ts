import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Customer, Order } from '../../entities';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { toPage, type Page } from '../../common/pagination';
import { normalizePhone, SQL_NORMALIZED_PHONE } from '../../common/phone';

/** What the till's live suggestions need — no orders, no timestamps. */
export interface CustomerSuggestion {
  id: string;
  name: string;
  phone: string;
  address: string;
  city: string | null;
}

/** The three fields a delivery order carries about its customer. */
export interface OrderCustomerInput {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
}

/**
 * The store's customer directory.
 *
 * STORE-SCOPED throughout: every read and write takes the caller's storeId
 * and never trusts one from the request body. A restaurant's delivery book
 * and a general store's contacts live in the same table but never meet.
 *
 * Phone is the identity of a customer within a store. It is stored
 * normalised (see common/phone.ts) and uniqueness is enforced here rather
 * than by an index, so the cashier sees "already exists" instead of a
 * driver error — the same choice ExpenseCategoriesService makes for names.
 */
@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private customersRepository: Repository<Customer>,
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    private dataSource: DataSource,
  ) {}

  /**
   * Rejects a second customer with the same phone in the same store.
   *
   * Compares the NORMALISED form on both sides, because rows written before
   * normalisation existed may still hold dashes and spaces.
   */
  private async assertPhoneFree(storeId: string, phone: string, exceptId?: string) {
    const qb = this.customersRepository
      .createQueryBuilder('customer')
      .where('customer.storeId = :storeId', { storeId })
      .andWhere(`${SQL_NORMALIZED_PHONE('"customer"."phone"')} = :phone`, { phone });
    if (exceptId) qb.andWhere('customer.id != :exceptId', { exceptId });

    if (await qb.getExists()) {
      throw new ConflictException('A customer with this phone number already exists');
    }
  }

  private async findByPhone(
    manager: EntityManager,
    storeId: string,
    phone: string,
  ): Promise<Customer | null> {
    return manager
      .createQueryBuilder(Customer, 'customer')
      .where('customer.storeId = :storeId', { storeId })
      .andWhere(`${SQL_NORMALIZED_PHONE('"customer"."phone"')} = :phone`, { phone })
      .orderBy('customer.createdAt', 'ASC')
      .getOne();
  }

  async create(storeId: string, dto: CreateCustomerDto): Promise<Customer> {
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new ConflictException('A phone number is required');
    await this.assertPhoneFree(storeId, phone);

    const customer = this.customersRepository.create({
      ...dto,
      name: dto.name.trim(),
      phone,
      storeId,
      email: dto.email?.trim() || null,
    } as Partial<Customer>);
    return await this.customersRepository.save(customer);
  }

  /**
   * The customer behind a delivery order: found by phone, or filed now.
   *
   * An existing row is returned UNTOUCHED — the cashier may have typed a
   * nickname or a different drop-off address for this one order, and the
   * order keeps that; the directory keeps what the owner curated. Runs inside
   * the order's transaction so an order and its customer commit together.
   */
  async findOrCreateFromOrder(
    manager: EntityManager,
    storeId: string,
    input: OrderCustomerInput,
  ): Promise<Customer | null> {
    const phone = normalizePhone(input.phone);
    if (!phone) return null;

    const existing = await this.findByPhone(manager, storeId, phone);
    if (existing) return existing;

    const customer = manager.create(Customer, {
      storeId,
      name: input.name?.trim() || 'Customer',
      phone,
      address: input.address?.trim() || '',
      isActive: true,
    });
    return manager.save(customer);
  }

  async findAll(storeId: string, skip?: number, take?: number): Promise<Customer[]> {
    return await this.customersRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
  }

  async findAllPaged(
    storeId: string,
    skip: number,
    take: number,
    search?: string,
  ): Promise<Page<Customer>> {
    const qb = this.customersRepository
      .createQueryBuilder('customer')
      .where('customer.storeId = :storeId', { storeId })
      .orderBy('customer.createdAt', 'DESC')
      .skip(skip)
      .take(take);

    const term = search?.trim();
    if (term) {
      const clauses = [
        `"customer"."name" ILIKE :term`,
        `COALESCE("customer"."email", '') ILIKE :term`,
        `COALESCE("customer"."phone", '') ILIKE :term`,
        `COALESCE("customer"."address", '') ILIKE :term`,
        `COALESCE("customer"."city", '') ILIKE :term`,
      ];
      // A phone typed with dashes must still find the normalised row.
      const phone = normalizePhone(term);
      if (phone.length >= 3) {
        clauses.push(`${SQL_NORMALIZED_PHONE('"customer"."phone"')} LIKE :phoneTerm`);
        qb.setParameter('phoneTerm', `%${phone}%`);
      }
      qb.andWhere(`(${clauses.join(' OR ')})`, { term: `%${term}%` });
    }

    const [items, total] = await qb.getManyAndCount();
    return toPage(items, total, skip, take);
  }

  /**
   * Live matches for the till as the cashier types a name, phone or address.
   *
   * Lean by design: a handful of columns, no joins, a hard cap. It is called
   * on every pause in typing, so it must cost less than the keystroke.
   */
  async suggest(storeId: string, query: string, limit = 8): Promise<CustomerSuggestion[]> {
    const term = query.trim();
    if (term.length < 2) return [];

    const qb = this.customersRepository
      .createQueryBuilder('customer')
      .select([
        'customer.id',
        'customer.name',
        'customer.phone',
        'customer.address',
        'customer.city',
      ])
      .where('customer.storeId = :storeId', { storeId })
      .andWhere('customer.isActive = true')
      .orderBy('customer.updatedAt', 'DESC')
      .take(Math.min(Math.max(limit, 1), 20));

    const phone = normalizePhone(term);
    const clauses = [
      `"customer"."name" ILIKE :term`,
      `COALESCE("customer"."address", '') ILIKE :term`,
      `COALESCE("customer"."phone", '') ILIKE :term`,
    ];
    if (phone.length >= 2) {
      clauses.push(`${SQL_NORMALIZED_PHONE('"customer"."phone"')} LIKE :phoneTerm`);
      qb.setParameter('phoneTerm', `%${phone}%`);
    }
    qb.andWhere(`(${clauses.join(' OR ')})`, { term: `%${term}%` });

    const rows = await qb.getMany();
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      city: c.city ?? null,
    }));
  }

  async findOne(id: string, storeId: string): Promise<Customer> {
    const customer = await this.customersRepository.findOne({ where: { id, storeId } });
    if (!customer) {
      throw new NotFoundException(`Customer #${id} not found`);
    }
    return customer;
  }

  async getCustomerWithOrders(
    id: string,
    storeId: string,
  ): Promise<{ customer: Customer; orders: Order[] }> {
    const customer = await this.findOne(id, storeId);
    const orders = await this.ordersRepository.find({
      where: { customerId: id, storeId },
      relations: ['items', 'items.product', 'createdBy'],
      order: { createdAt: 'DESC' },
    });
    return { customer, orders };
  }

  async update(id: string, storeId: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.findOne(id, storeId);

    const patch: Partial<Customer> = { ...dto } as Partial<Customer>;
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.email !== undefined) patch.email = dto.email?.trim() || null;
    if (dto.phone !== undefined) {
      const phone = normalizePhone(dto.phone);
      if (!phone) throw new ConflictException('A phone number is required');
      if (phone !== normalizePhone(customer.phone)) {
        await this.assertPhoneFree(storeId, phone, id);
      }
      patch.phone = phone;
    }

    const updated = this.customersRepository.merge(customer, patch);
    return await this.customersRepository.save(updated);
  }

  /**
   * Deletes the customer and unlinks their orders.
   *
   * Orders keep the name, phone and address they were placed with (those are
   * snapshotted on the row), so nothing about a past sale is lost — only the
   * link. Without the unlink the FK would refuse the delete.
   */
  async remove(id: string, storeId: string): Promise<void> {
    const customer = await this.findOne(id, storeId);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Order, { customerId: customer.id, storeId }, { customerId: null });
      await manager.delete(Customer, { id: customer.id });
    });
  }
}
