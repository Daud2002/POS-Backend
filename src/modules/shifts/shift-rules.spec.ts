import { drawerMaths, tipsDueFromDrawer } from './shift-rules';

/**
 * The owner's handover table, row by row.
 *
 * The till in every row: opening float 1,000 + cash received 5,000 = 6,000 in
 * the drawer, nothing paid out. Where cash tips are recorded, 300 of that
 * cash is tips (so cash sales are 4,700). Where card/online tips are
 * recorded, they are 200 (120 by card, 80 online).
 */
describe('cash to hand over', () => {
  const till = (options: { cashTips: boolean; cardOnlineTips: boolean; takenFromCash: boolean }) => {
    const cashTips = options.cashTips ? 300 : 0;
    const cardTips = options.cardOnlineTips ? 120 : 0;
    const onlineTips = options.cardOnlineTips ? 80 : 0;
    return drawerMaths({
      openingFloat: 1000,
      cashSales: 5000 - cashTips,
      cashPaidOut: 0,
      cashTips,
      tipsFromDrawer: tipsDueFromDrawer(cardTips, onlineTips, options.takenFromCash),
    });
  };

  it('1 — cash and card/online tips, taken from cash: 6,000 − 300 − 200', () => {
    const drawer = till({ cashTips: true, cardOnlineTips: true, takenFromCash: true });
    expect(drawer.cashReceived).toBe(5000);
    expect(drawer.cashInDrawer).toBe(6000);
    expect(drawer.expectedCash).toBe(5500);
    expect(drawer.tipsOwed).toBe(0);
  });

  it('2 — cash and card/online tips, not taken from cash: 6,000 − 300', () => {
    const drawer = till({ cashTips: true, cardOnlineTips: true, takenFromCash: false });
    expect(drawer.cashInDrawer).toBe(6000);
    expect(drawer.expectedCash).toBe(5700);
  });

  it('3 — cash tips only, switch on: 6,000 − 300', () => {
    expect(till({ cashTips: true, cardOnlineTips: false, takenFromCash: true }).expectedCash).toBe(5700);
  });

  it('4 — cash tips only, switch off: 6,000 − 300', () => {
    expect(till({ cashTips: true, cardOnlineTips: false, takenFromCash: false }).expectedCash).toBe(5700);
  });

  it('5 — card/online tips only, taken from cash: 6,000 − 200', () => {
    expect(till({ cashTips: false, cardOnlineTips: true, takenFromCash: true }).expectedCash).toBe(5800);
  });

  it('6 — card/online tips only, not taken from cash: 6,000', () => {
    expect(till({ cashTips: false, cardOnlineTips: true, takenFromCash: false }).expectedCash).toBe(6000);
  });

  it('7 — no tips recorded: 6,000, exactly as before tips existed', () => {
    const drawer = till({ cashTips: false, cardOnlineTips: false, takenFromCash: false });
    expect(drawer.expectedCash).toBe(6000);
    expect(drawer.cashInDrawer).toBe(6000);
    expect(drawer.cashReceived).toBe(5000);
  });
});

describe('drawerMaths', () => {
  it('takes cash paid out off the handover', () => {
    const drawer = drawerMaths({
      openingFloat: 1000,
      cashSales: 4700,
      cashPaidOut: 400,
      cashTips: 300,
      tipsFromDrawer: 200,
    });
    expect(drawer.cashInDrawer).toBe(5600);
    expect(drawer.expectedCash).toBe(5100);
  });

  it('never asks for less than nothing when card tips outrun the drawer', () => {
    // A quiet cash day: 1,000 float, 200 of cash sales, 1,500 of card tips.
    const drawer = drawerMaths({
      openingFloat: 1000,
      cashSales: 200,
      cashPaidOut: 0,
      cashTips: 0,
      tipsFromDrawer: 1500,
    });
    expect(drawer.expectedCash).toBe(0);
    // The drawer covered 1,200 of them; the owner still owes staff the rest.
    expect(drawer.tipsOwed).toBe(300);
  });

  it('leaves a shift without tips on the old formula, overdrawn or not', () => {
    expect(
      drawerMaths({ openingFloat: 0, cashSales: 100, cashPaidOut: 300, cashTips: 0, tipsFromDrawer: 0 }),
    ).toEqual({ cashReceived: 100, cashInDrawer: -200, expectedCash: -200, tipsOwed: 0 });
  });

  it('rounds to the paisa', () => {
    const drawer = drawerMaths({
      openingFloat: 0.1,
      cashSales: 0.2,
      cashPaidOut: 0,
      cashTips: 0.05,
      tipsFromDrawer: 0,
    });
    expect(drawer.cashInDrawer).toBe(0.35);
    expect(drawer.expectedCash).toBe(0.3);
  });
});

describe('tipsDueFromDrawer', () => {
  it('is the card and online tips when the store pays them from cash, else nothing', () => {
    expect(tipsDueFromDrawer(120, 80, true)).toBe(200);
    expect(tipsDueFromDrawer(120, 80, false)).toBe(0);
    expect(tipsDueFromDrawer(0, 0, true)).toBe(0);
  });
});
