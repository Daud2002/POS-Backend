import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Store, SubscriptionPayment } from '@/entities';
import { computeNewExpiry, todayInZone } from '@/common';
import { ExtendSubscriptionDto } from './dto';

/**
 * Recording that a store paid, and for how long.
 *
 * The store row holds the answer (`subscriptionExpiresAt`); every change to
 * it is also a `subscription_payments` row, written in the same transaction,
 * so the history can never disagree with the current date. The arithmetic
 * itself lives in `common/subscription.ts` where the clients mirror it.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(SubscriptionPayment)
    private readonly payments: Repository<SubscriptionPayment>,
    private readonly dataSource: DataSource,
  ) {}

  async extend(storeId: string, dto: ExtendSubscriptionDto, admin: { id: string; name?: string | null }) {
    const hasMonths = dto.months !== undefined && dto.months !== null;
    const hasDate = dto.expiresAt !== undefined && dto.expiresAt !== null && dto.expiresAt !== '';
    if (hasMonths === hasDate) {
      throw new BadRequestException('Provide either a number of months or an exact expiry date, not both');
    }

    const store = await this.stores.findOne({ where: { id: storeId } });
    if (!store) throw new NotFoundException(`Store with ID ${storeId} not found`);

    // "Today" in the admin's own day, so a payment recorded at 11pm counts
    // from the date on the admin's calendar, not the server's.
    const today = todayInZone(new Date(), dto.tz);
    const previous = store.subscriptionExpiresAt ?? null;

    let newExpiry: string;
    try {
      newExpiry = computeNewExpiry({
        today,
        current: previous,
        months: hasMonths ? dto.months : undefined,
        expiresAt: hasDate ? dto.expiresAt : undefined,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const payment = await this.dataSource.transaction(async (manager) => {
      const row = await manager.save(
        SubscriptionPayment,
        manager.create(SubscriptionPayment, {
          storeId,
          previousExpiresAt: previous,
          newExpiresAt: newExpiry,
          months: hasMonths ? dto.months : null,
          note: dto.note?.trim() || null,
          adminId: admin.id,
          adminName: admin.name ?? null,
        }),
      );
      await manager.update(Store, { id: storeId }, { subscriptionExpiresAt: newExpiry });
      return row;
    });

    return {
      store: { id: store.id, name: store.name, subscriptionExpiresAt: newExpiry },
      payment,
    };
  }

  async history(storeId: string): Promise<SubscriptionPayment[]> {
    return this.payments.find({ where: { storeId }, order: { createdAt: 'DESC' }, take: 100 });
  }
}
