import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SettleCreditDto, SettleOrderDto } from './index';

/**
 * The global ValidationPipe runs with `whitelist: true`: a field without a
 * decorator is dropped before the service ever sees it. A tip that vanished
 * that way would be taken from the customer and recorded nowhere, so the tip
 * fields are pinned here on both ways of taking money.
 */
describe.each([
  ['settle', SettleOrderDto],
  ['credit settle', SettleCreditDto],
])('%s body', (_name, Dto) => {
  const check = async (body: Record<string, unknown>) => {
    const dto = plainToInstance(Dto as new () => object, body);
    const errors = await validate(dto, { whitelist: true, forbidUnknownValues: false });
    return { dto: dto as Record<string, unknown>, fields: errors.map((e) => e.property) };
  };

  it('keeps the tip, its method and the bill the till saw', async () => {
    const { dto, fields } = await check({
      paymentMethod: 'card',
      tipAmount: 150,
      tipMethod: 'card',
      expectedTotal: 1850,
      somethingElse: 'dropped',
    });
    expect(fields).toEqual([]);
    expect(dto).toMatchObject({ paymentMethod: 'card', tipAmount: 150, tipMethod: 'card', expectedTotal: 1850 });
    expect(dto).not.toHaveProperty('somethingElse');
  });

  it('accepts a payment with no tip at all', async () => {
    expect((await check({ paymentMethod: 'cash' })).fields).toEqual([]);
    expect((await check({})).fields).toEqual([]);
  });

  it('rejects a tip that is not a sensible amount', async () => {
    expect((await check({ tipAmount: -1 })).fields).toEqual(['tipAmount']);
    expect((await check({ tipAmount: '150' })).fields).toEqual(['tipAmount']);
    // Larger than the decimal(10,2) column can hold.
    expect((await check({ tipAmount: 100_000_000 })).fields).toEqual(['tipAmount']);
  });

  it('only lets a tip arrive by cash, card or online', async () => {
    expect((await check({ tipAmount: 50, tipMethod: 'check' })).fields).toEqual(['tipMethod']);
    expect((await check({ tipAmount: 50, tipMethod: 'partial' })).fields).toEqual(['tipMethod']);
    expect((await check({ tipAmount: 50, tipMethod: 'online' })).fields).toEqual([]);
  });

  it('rejects a negative expected total', async () => {
    expect((await check({ expectedTotal: -5 })).fields).toEqual(['expectedTotal']);
  });
});
