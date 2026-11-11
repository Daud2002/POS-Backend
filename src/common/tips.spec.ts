import { TipGrid, tipCellsFrom, tipOrderType, tipPolicyOf, tipTotal, tipsByMethod } from './tips';

describe('tip order types', () => {
  it('counts dine-out as dine-in', () => {
    expect(tipOrderType('dine_in')).toBe('dine_in');
    expect(tipOrderType('dine_out')).toBe('dine_in');
    expect(tipOrderType('takeaway')).toBe('takeaway');
    expect(tipOrderType('delivery')).toBe('delivery');
  });

  it('files anything unexpected under dine-in so no tip goes missing', () => {
    expect(tipOrderType('none')).toBe('dine_in');
    expect(tipOrderType(null)).toBe('dine_in');
  });
});

describe('TipGrid', () => {
  it('lists only the cells that hold tips, in a fixed order', () => {
    const grid = new TipGrid();
    grid.add('delivery', 'online', 400);
    grid.add('dine_out', 'card', 200);
    grid.add('dine_in', 'card', 250);
    grid.add('takeaway', 'cash', '100.50');
    grid.add('dine_in', 'cash', 300);

    expect(grid.toCells()).toEqual([
      { orderType: 'dine_in', method: 'cash', amount: 300 },
      // dine_in 250 + dine_out 200
      { orderType: 'dine_in', method: 'card', amount: 450 },
      { orderType: 'takeaway', method: 'cash', amount: 100.5 },
      { orderType: 'delivery', method: 'online', amount: 400 },
    ]);
  });

  it('ignores orders without a tip', () => {
    const grid = new TipGrid();
    grid.add('dine_in', null, 0);
    grid.add('dine_in', 'cash', 0);
    grid.add('dine_in', 'cash', null);
    grid.add('dine_in', 'check', 50);
    expect(grid.toCells()).toEqual([]);
  });

  it('never lists more than nine lines', () => {
    const grid = new TipGrid();
    for (const type of ['dine_in', 'dine_out', 'takeaway', 'delivery']) {
      for (const method of ['cash', 'card', 'online']) grid.add(type, method, 10);
    }
    const cells = grid.toCells();
    expect(cells).toHaveLength(9);
    expect(tipTotal(cells)).toBe(120);
    expect(tipsByMethod(cells)).toEqual({ cash: 40, card: 40, online: 40 });
  });
});

describe('tipCellsFrom', () => {
  it('reads a stored breakdown back', () => {
    expect(tipCellsFrom([{ orderType: 'takeaway', method: 'card', amount: '75.00' }])).toEqual([
      { orderType: 'takeaway', method: 'card', amount: 75 },
    ]);
  });

  it('treats a shift closed before tips existed as having none', () => {
    expect(tipCellsFrom(null)).toEqual([]);
    expect(tipCellsFrom(undefined)).toEqual([]);
    expect(tipCellsFrom('nonsense')).toEqual([]);
  });
});

describe('tipPolicyOf', () => {
  it('reads the three switches, off by default', () => {
    expect(tipPolicyOf({ tipsCashEnabled: true, tipsOnlineEnabled: true })).toEqual({
      cash: true,
      card: false,
      online: true,
    });
    expect(tipPolicyOf(null)).toEqual({ cash: false, card: false, online: false });
  });
});
