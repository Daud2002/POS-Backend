import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Expense, ExpenseCategory, type ExpensePaymentMethod } from '@/entities';
import { toPage, type Page } from '@/common';
import { ShiftsService } from '../shifts/shifts.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto';

/** Who is writing the ledger: the id for the audit column, the role for the shift rule. */
export interface ExpenseActor {
  id: string;
  effectiveRole?: string | null;
}

/** The roles that work a drawer, and so must have one open to touch the ledger. */
export const SHIFT_GATED_ROLES: ReadonlyArray<string> = ['cashier', 'supervisor'];

export const OPEN_SHIFT_FOR_EXPENSES =
  'Open your shift before recording an expense — cash spend is counted against your drawer.';

export interface ExpenseSummary {
  /** The calendar day these figures were computed for, echoed back. */
  date: string;
  today: number;
  todayCount: number;
  month: number;
  monthCount: number;
}

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private expensesRepository: Repository<Expense>,
    @InjectRepository(ExpenseCategory)
    private categoriesRepository: Repository<ExpenseCategory>,
    private shiftsService: ShiftsService,
    private dataSource: DataSource,
  ) {}

  /** 'YYYY-MM-DD' for the server's local day, used when a client sends none. */
  private serverToday(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  /**
   * Whether this actor must have a drawer open to touch the ledger.
   *
   * Cashiers and supervisors, on a tenant that has shifts on — exactly the
   * rule settling uses. Everyone else is exempt: owners have no drawer to
   * open, and a waiter or kitchen hand granted the expenses module cannot
   * open a shift at all, so gating them would lock them out of the ledger.
   */
  private async isShiftGated(storeId: string, actor: ExpenseActor | undefined): Promise<boolean> {
    if (!actor?.effectiveRole || !SHIFT_GATED_ROLES.includes(actor.effectiveRole)) return false;
    return this.shiftsService.isEnforced(storeId);
  }

  /**
   * The gated actor's open drawer, or a 409 telling them to open one.
   *
   * Runs inside the caller's transaction so the FOR SHARE lock in
   * findOpenShift holds until the ledger row is written: close() cannot
   * snapshot the drawer between this check and the expense landing on it.
   */
  private async requireOpenShift(
    manager: EntityManager,
    storeId: string,
    actor: ExpenseActor,
  ): Promise<string> {
    try {
      const stamp = await this.shiftsService.stampSettlement(manager, storeId, actor.id, { enforce: true });
      return stamp.shiftId as string;
    } catch (error) {
      if (error instanceof ConflictException) throw new ConflictException(OPEN_SHIFT_FOR_EXPENSES);
      throw error;
    }
  }

  /**
   * The open drawer this spend came out of, if any — for actors who are NOT
   * gated (owners, waiters granted the ledger).
   *
   * Returns null rather than throwing on any failure: linking to a shift makes
   * the till reconcile, but for these roles it must never be the reason
   * booking an expense fails. Cashiers and supervisors never reach this: for
   * them the shift is required, not optional (see requireOpenShift).
   */
  private async resolveShiftId(
    manager: EntityManager,
    storeId: string,
    paymentMethod: string | undefined,
    createdById: string | undefined,
  ): Promise<string | null> {
    if (paymentMethod !== 'cash' || !createdById) return null;

    try {
      const stamp = await this.shiftsService.stampSettlement(manager, storeId, createdById, {
        enforce: false,
      });
      return stamp.shiftId;
    } catch {
      return null;
    }
  }

  /** A category id must belong to the same store, or it is not a real link. */
  private async assertCategoryInStore(storeId: string, categoryId?: string | null) {
    if (!categoryId) return;
    const exists = await this.categoriesRepository.findOne({
      where: { id: categoryId, storeId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('Expense category not found for this store');
  }

  async create(
    storeId: string,
    dto: CreateExpenseDto,
    actor?: ExpenseActor,
  ): Promise<Expense> {
    await this.assertCategoryInStore(storeId, dto.categoryId);
    const gated = await this.isShiftGated(storeId, actor);
    const createdById = actor?.id;

    const saved = await this.dataSource.transaction(async (manager) => {
      /**
       * A CASH expense entered while the author has a drawer open is money
       * that physically left that drawer, so it must reduce their expected
       * cash — otherwise the cashier who paid a supplier looks short at
       * closing. A cashier or supervisor therefore cannot book ANY expense
       * without an open drawer (one rule for staff, whatever the method);
       * everyone else is linked when a drawer happens to be open.
       *
       * Attached by WHEN it was entered, not by `expenseDate`: back-dating a
       * receipt does not change which till the notes came out of. Card/bank
       * spend never touches a drawer, so it stays unlinked.
       */
      let shiftId: string | null;
      if (gated) {
        const openShiftId = await this.requireOpenShift(manager, storeId, actor as ExpenseActor);
        shiftId = dto.paymentMethod === 'cash' ? openShiftId : null;
      } else {
        shiftId = await this.resolveShiftId(manager, storeId, dto.paymentMethod, createdById);
      }

      // `paymentMethod` is validated against the same list by @IsIn, but the
      // DTO types it as a plain string so it does not import the entity's union.
      const expense = manager.create(Expense, {
        ...dto,
        title: dto.title.trim(),
        storeId,
        createdById: createdById ?? null,
        shiftId,
        paymentMethod: (dto.paymentMethod as ExpensePaymentMethod) ?? null,
        // The client sends its own local day; falling back to the server's is
        // only for API callers that omit it.
        expenseDate: dto.expenseDate ?? this.serverToday(),
      } as Partial<Expense>);

      return manager.save(Expense, expense);
    });

    return this.findOne(saved.id, storeId);
  }

  private baseQuery(storeId: string, filters: ExpenseFilters = {}) {
    const qb = this.expensesRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.category', 'category')
      .leftJoinAndSelect('expense.createdBy', 'createdBy')
      .where('expense.storeId = :storeId', { storeId });

    if (filters.from) qb.andWhere('expense.expenseDate >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('expense.expenseDate <= :to', { to: filters.to });

    if (filters.categoryId) {
      // A literal 'none' is how the client asks for the uncategorized bucket;
      // an `= NULL` comparison would silently match nothing.
      if (filters.categoryId === 'none') {
        qb.andWhere('expense.categoryId IS NULL');
      } else {
        qb.andWhere('expense.categoryId = :categoryId', { categoryId: filters.categoryId });
      }
    }

    const term = filters.search?.trim();
    if (term) {
      qb.andWhere(
        `("expense"."title" ILIKE :term
          OR COALESCE("expense"."notes", '') ILIKE :term
          OR COALESCE("category"."name", '') ILIKE :term)`,
        { term: `%${term}%` },
      );
    }

    return qb;
  }

  async findAll(storeId: string, filters: ExpenseFilters = {}, skip?: number, take?: number) {
    const qb = this.baseQuery(storeId, filters)
      // Two keys: several expenses share a day, and `expenseDate` is a plain
      // date, so entry order is the only stable tie-break.
      .orderBy('expense.expenseDate', 'DESC')
      .addOrderBy('expense.createdAt', 'DESC');

    if (skip !== undefined) qb.skip(skip);
    if (take !== undefined) qb.take(take);

    return qb.getMany();
  }

  async findAllPaged(
    storeId: string,
    skip: number,
    take: number,
    filters: ExpenseFilters = {},
  ): Promise<Page<Expense> & { filteredTotal: number }> {
    const qb = this.baseQuery(storeId, filters)
      .orderBy('expense.expenseDate', 'DESC')
      .addOrderBy('expense.createdAt', 'DESC')
      .skip(skip)
      .take(take);

    const [items, total] = await qb.getManyAndCount();

    // The summed value of everything MATCHING THE FILTER, not just this page —
    // a pager that shows 20 rows and a total for those 20 rows is misleading.
    const { sum } = await this.baseQuery(storeId, filters)
      .select('COALESCE(SUM(expense.amount), 0)', 'sum')
      .getRawOne<{ sum: string }>();

    return { ...toPage(items, total, skip, take), filteredTotal: Number(sum) || 0 };
  }

  async findOne(id: string, storeId: string): Promise<Expense> {
    const expense = await this.expensesRepository.findOne({
      where: { id, storeId },
      relations: ['category', 'createdBy'],
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async update(id: string, storeId: string, dto: UpdateExpenseDto, actor?: ExpenseActor): Promise<Expense> {
    const expense = await this.findOne(id, storeId);
    // Editing an amount moves the drawer's expected cash as much as adding one.
    await this.assertShiftIfGated(storeId, actor);

    if (dto.categoryId !== undefined) {
      await this.assertCategoryInStore(storeId, dto.categoryId);
    }

    this.expensesRepository.merge(expense, {
      ...dto,
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.paymentMethod !== undefined
        ? { paymentMethod: dto.paymentMethod as ExpensePaymentMethod }
        : {}),
    } as Partial<Expense>);

    await this.expensesRepository.save(expense);
    return this.findOne(id, storeId);
  }

  async remove(id: string, storeId: string, actor?: ExpenseActor): Promise<{ message: string }> {
    const expense = await this.findOne(id, storeId);
    await this.assertShiftIfGated(storeId, actor);
    await this.expensesRepository.remove(expense);
    return { message: 'Expense deleted' };
  }

  /** The guard alone, for writes that do not stamp a row (edits, deletes). */
  private async assertShiftIfGated(storeId: string, actor: ExpenseActor | undefined): Promise<void> {
    if (!(await this.isShiftGated(storeId, actor))) return;
    await this.requireOpenShift(this.dataSource.manager, storeId, actor as ExpenseActor);
  }

  /**
   * Headline figures for the owner's dashboard.
   *
   * `date` comes from the client so "today" is the user's calendar day rather
   * than the server's — a store an hour ahead of the API would otherwise see
   * its evening spend counted as tomorrow's.
   */
  async summary(storeId: string, date?: string): Promise<ExpenseSummary> {
    const today = date ?? this.serverToday();
    const monthStart = `${today.slice(0, 7)}-01`;

    const totals = async (from: string, to: string) => {
      const row = await this.expensesRepository
        .createQueryBuilder('expense')
        .select('COALESCE(SUM(expense.amount), 0)', 'sum')
        .addSelect('COUNT(expense.id)', 'count')
        .where('expense.storeId = :storeId', { storeId })
        .andWhere('expense.expenseDate >= :from', { from })
        .andWhere('expense.expenseDate <= :to', { to })
        .getRawOne<{ sum: string; count: string }>();

      // Postgres returns SUM as a string and COUNT as a bigint string; both
      // need coercing or they concatenate downstream.
      return { sum: Number(row?.sum) || 0, count: Number(row?.count) || 0 };
    };

    const [day, month] = await Promise.all([
      totals(today, today),
      totals(monthStart, today),
    ]);

    return {
      date: today,
      today: day.sum,
      todayCount: day.count,
      month: month.sum,
      monthCount: month.count,
    };
  }

  /**
   * Total spend on or after each of several calendar days, in one query.
   *
   * Feeds the profit report: each dashboard window (today, this month, …)
   * becomes one `SUM ... FILTER` column, so six windows cost one table scan
   * rather than six. A null lower bound means "everything".
   *
   * `expenseDate` is a plain DATE, so the bounds are 'YYYY-MM-DD' strings —
   * no timezone arithmetic happens here; the caller already chose the days.
   */
  async sumByPeriods<K extends string>(
    storeId: string,
    starts: Record<K, string | null>,
  ): Promise<Record<K, number>> {
    const qb = this.expensesRepository
      .createQueryBuilder('expense')
      .where('expense.storeId = :storeId', { storeId });

    /**
     * The FIRST column goes through select(), which REPLACES the builder's
     * default `SELECT expense.*`; the rest append. With addSelect alone the
     * entity columns stay in the list and Postgres refuses the aggregate:
     * "column expense.id must appear in the GROUP BY clause". That 500 took
     * the whole profit report down for anyone holding the expenses module.
     */
    const keys = Object.keys(starts) as K[];
    keys.forEach((key, index) => {
      const from = starts[key];
      const pick = index === 0 ? qb.select.bind(qb) : qb.addSelect.bind(qb);
      if (from === null) {
        pick('COALESCE(SUM("expense"."amount"), 0)', key);
      } else {
        const param = `from${index}`;
        pick(
          `COALESCE(SUM("expense"."amount") FILTER (WHERE "expense"."expenseDate" >= :${param}), 0)`,
          key,
        );
        qb.setParameter(param, from);
      }
    });

    const row = (await qb.getRawOne<Record<K, string>>()) ?? ({} as Record<K, string>);
    const out = {} as Record<K, number>;
    for (const key of keys) out[key] = Number(row[key]) || 0;
    return out;
  }
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  /** A category id, or the literal 'none' for uncategorized. */
  categoryId?: string;
  search?: string;
}
