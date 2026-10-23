import { AuditService } from './audit.service';

function queryBuilder(result: Record<string, unknown>) {
  const qb: any = {};
  for (const method of ['orderBy', 'andWhere', 'where', 'skip', 'take', 'select', 'addSelect', 'distinct']) {
    qb[method] = jest.fn(() => qb);
  }
  return Object.assign(qb, result);
}

describe('AuditService.log', () => {
  const entry = {
    module: 'orders',
    action: 'order.settled',
    summary: 'Order #1 settled',
    method: 'POST',
    path: '/api/restaurant/orders/x/settle',
    statusCode: 201,
  } as any;

  it('writes the row', async () => {
    const repo = { insert: jest.fn(async () => ({})) };
    const service = new AuditService(repo as any);

    await service.log(entry);

    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.settled' }));
  });

  it('never rejects when the insert fails', async () => {
    const repo = { insert: jest.fn(async () => { throw new Error('connection reset'); }) };
    const service = new AuditService(repo as any);

    await expect(service.log(entry)).resolves.toBeUndefined();
  });

  it('bounds the columns it writes', async () => {
    const repo = { insert: jest.fn(async (_row: unknown) => ({})) };
    const service = new AuditService(repo as any);

    await service.log({ ...entry, summary: 'x'.repeat(1000), path: '/p'.repeat(300) });

    const written = repo.insert.mock.calls[0][0] as any;
    expect(written.summary.length).toBe(300);
    expect(written.path.length).toBe(200);
  });
});

describe('AuditService.query', () => {
  it('applies only the filters given and pages newest first', async () => {
    const qb = queryBuilder({ getManyAndCount: jest.fn(async () => [[{ id: 'a' }], 1]) });
    const repo = { createQueryBuilder: jest.fn(() => qb) };
    const service = new AuditService(repo as any);

    const page = await service.query(
      { storeId: 's1', from: '2026-10-01', to: '2026-10-21', search: 'settled' },
      { skip: 20, take: 20 },
    );

    expect(page).toEqual({ items: [{ id: 'a' }], total: 1, skip: 20, take: 20 });
    expect(qb.orderBy).toHaveBeenCalledWith('log.createdAt', 'DESC');
    const clauses = qb.andWhere.mock.calls.map((c: unknown[]) => c[0]);
    expect(clauses).toEqual(
      expect.arrayContaining(['log.storeId = :storeId', 'log.createdAt >= :from', 'log.createdAt <= :to']),
    );
    expect(clauses.some((c: string) => c.includes('ILIKE'))).toBe(true);
    expect(clauses).not.toContain('log.module = :module');

    // A bare day covers the whole day.
    const toParams = qb.andWhere.mock.calls.find((c: unknown[]) => c[0] === 'log.createdAt <= :to')?.[1] as any;
    expect(toParams.to.toISOString()).toBe('2026-10-21T23:59:59.999Z');
  });
});

describe('AuditService.filters', () => {
  it('merges the route table with what has been recorded', async () => {
    const qb = queryBuilder({
      getRawMany: jest.fn(async () => [{ module: 'widgets', action: 'POST /widgets' }]),
    });
    const repo = { createQueryBuilder: jest.fn(() => qb) };
    const service = new AuditService(repo as any);

    const out = await service.filters();

    expect(out.modules).toEqual(expect.arrayContaining(['orders', 'widgets', 'subscriptions']));
    expect(out.actions.widgets).toEqual(['POST /widgets']);
    expect(out.actions.orders).toContain('order.punched');
  });
});
