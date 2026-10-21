/**
 * The Snack Fuel menu, as printed — one definition shared by the seeder
 * (`seed-snackfuel.ts`, which builds a store from scratch), the sync script
 * (`sync-snackfuel-menu.ts`, which brings an existing store into line) and the
 * cost script (`update-snackfuel-costs.ts`, which writes only the costs).
 *
 * Order matters: categories are numbered 1..N and products 1..M in the order
 * they appear here, and that is the order the till shows them in. Icons are
 * emojis from the same shelf the product form offers, so every one of them is
 * also pickable by hand afterwards.
 *
 * Costs come from the owner's costing sheets (October 2026); the deal, box,
 * Doner Pizza, add-on and Glass costs were entered on the till on
 * 2026-10-19/20 and copied back here. Every item is costed; one added without
 * a `cost` falls back to COST_RATIO of its price.
 */

export interface Item {
  name: string;
  price: number;
  /** Shelf emoji, stored in `products.image`. */
  icon: string;
  description?: string;
  /** What one serving costs to make, from the owner's costing. Absent → COST_RATIO of price. */
  cost?: number;
}

export interface Group {
  category: string;
  description: string;
  /** Shelf emoji, stored in `categories.image`. */
  icon: string;
  items: Item[];
}

/** The Snack Fuel store, as created in the database. */
export const SNACKFUEL_STORE_ID = '44879279-97cd-4fb1-a513-f68a4f3d35c3';

/** Fallback cost = price × COST_RATIO, for an item added without a costing of its own. */
export const COST_RATIO = 0.75;

/** Bottled drinks are bought in, so they cost a flat share of what they sell for. */
export const DRINK_COST_RATIO = 0.8;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The cost to store for a menu item: its own costing, else COST_RATIO of `price`. */
export function costOf(item: Item, price = item.price): number {
  return item.cost ?? round2(price * COST_RATIO);
}

/**
 * The 72 icons the product/category forms offer (POS-Frontend
 * src/lib/menuIcons.ts and POS-Mobile src/constants/emojis.ts). Anything not
 * on it would show on the till but could not be re-picked from the form.
 */
export const SHELF = new Set([
  '🍔', '🍕', '🍟', '🌭', '🥪', '🌮', '🌯', '🥙', '🍝', '🍜', '🍲', '🍛',
  '🍗', '🍖', '🥩', '🍢', '🍤', '🐟', '🦐', '🥓', '🍳', '🥚', '🧆', '🫓',
  '🥗', '🍚', '🍱', '🥘', '🍞', '🥐', '🥖', '🧀', '🥔', '🌽', '🥕', '🥒',
  '🍰', '🧁', '🍩', '🍪', '🍫', '🍬', '🍮', '🍨', '🍦', '🥧', '🍯', '🍡',
  '☕', '🍵', '🥤', '🧋', '🧃', '🥛', '🧉', '🍺', '🍷', '🍹', '🧊', '🍾',
  '🍎', '🍌', '🍇', '🍓', '🍉', '🥭', '🍍', '🥥', '📦', '🛍️', '🧴', '🧼',
]);

/** Builds `flavour (Size)` rows — the schema has one price per product. */
function sized(
  flavours: string[],
  sizes: Array<[label: string, price: number, cost: number]>,
  icon: string,
): Item[] {
  const rows: Item[] = [];
  for (const flavour of flavours) {
    for (const [label, price, cost] of sizes) {
      rows.push({ name: `${flavour} (${label})`, price, icon, cost });
    }
  }
  return rows;
}

const item = (icon: string) => (name: string, price: number, cost?: number): Item =>
  cost === undefined ? { name, price, icon } : { name, price, icon, cost };

/** Boxes and deals: described. One with no `cost` falls back to COST_RATIO. */
const combo = (icon: string) => (name: string, price: number, description: string, cost?: number): Item =>
  cost === undefined ? { name, price, icon, description } : { name, price, icon, description, cost };

const drink = (icon: string) => (name: string, price: number): Item =>
  item(icon)(name, price, round2(price * DRINK_COST_RATIO));

const TRADITIONAL = [
  'Tikka', 'Fajita', 'Supreme', 'Cheese Margarita',
  'Veg Lover', 'Hot n Spicy', 'Chicken Lover',
];

const SPECIAL = [
  'Pepperoni', 'Malai Boti', 'Arabic Ranch', 'Mughal-e-Azam',
  'Bihari Kebab', 'Tandoori Chicken', 'Peri Peri',
];

const STUFFED = [
  'Snack Fuel Special', 'Kebab Stuff', 'Cheese Stuff',
  'Dawat-e-Khass', 'Crown Crust',
];

const DIPS = [
  'SF Special', 'Cocktail', 'Mint Mustard',
  'Honey Mustard', 'Garlic Mayo', 'Chipotle',
];

const fries = item('🍟');
const chicken = item('🍗');
const cheese = item('🧀');
const burger = item('🍔');
const beef = item('🥩');
const wrap = item('🌯');
const pasta = item('🍝');
const sandwich = item('🥪');
const pizza = item('🍕');
const dip = item('🍯');
const soda = drink('🥤');
const water = drink('🧊');
const addon = item('📦');

export const MENU: Group[] = [
  {
    category: 'Appetizers',
    description: 'Fries, wings, nuggets and sides',
    icon: '🍟',
    items: [
      fries('Regular Fries (S)', 220, 166),
      fries('Regular Fries (L)', 270, 206),
      fries('Masala Fries', 230, 216),
      fries('Garlic Mayo Fries', 250, 226),
      fries('Loaded Fries', 550, 383),
      chicken('Nuggets (6 pcs)', 290, 240),
      chicken('Nuggets (12 pcs)', 550, 374),
      chicken('Crunchy Wings (6 pcs)', 380, 228),
      chicken('Crunchy Wings (12 pcs)', 680, 360),
      chicken('Oven Baked Wings (6 pcs)', 400, 237),
      chicken('Oven Baked Wings (12 pcs)', 750, 376),
      chicken('Honey BBQ Wings (6 pcs)', 400, 287),
      chicken('Honey BBQ Wings (12 pcs)', 750, 426),
      cheese('Cheese Sticks', 500, 321),
      cheese('Chicken Cheese Sticks', 650, 375),
      // Not on the costing sheet; the owner kept it at 75% of price.
      chicken('Chicken Strips (4 pcs)', 300, 225),
      item('🧆')('Spin Rolls', 650, 439),
    ],
  },
  {
    category: 'Burgers',
    description: 'Chicken burgers and zingers',
    icon: '🍔',
    items: [
      burger('Patty Burger (Single)', 300, 245),
      burger('Patty Burger (Double)', 450, 324),
      burger('Fillet Grilled (Single)', 500, 378),
      burger('Fillet Grilled (Double)', 750, 500),
      burger('Zinger Mini', 300, 293),
      burger('Zinger Jumbo', 450, 332),
      burger('Big Bite Zinger', 700, 456),
      burger('Tender Fillet', 550, 388),
    ],
  },
  {
    category: 'Beef Burgers',
    description: 'Smash and classic beef burgers',
    icon: '🥩',
    items: [
      beef('Classic', 520, 453),
      beef('Smash (Single)', 600, 453),
      beef('Smash (Double)', 800, 625),
      // The costing sheet's "Onion Single"; there is no double on the menu.
      beef('Smash Onion', 650, 480),
      beef('Beef Mexican', 650, 453),
    ],
  },
  {
    category: 'Wraps',
    description: 'Rolls and tortilla wraps',
    icon: '🌯',
    items: [
      wrap('SF Special', 650, 420),
      wrap('Twister', 550, 429),
      wrap('Grilled', 550, 440),
      wrap('Tortilla', 520, 475),
    ],
  },
  {
    category: 'Pasta',
    description: 'Half and full portions',
    icon: '🍝',
    items: [
      pasta('SF Special (Half)', 400, 265),
      pasta('SF Special (Full)', 750, 465),
      pasta('Creamy Pasta (Half)', 350, 235),
      pasta('Creamy Pasta (Full)', 650, 420),
      pasta('Crunchy Pasta (Half)', 400, 265),
      pasta('Crunchy Pasta (Full)', 750, 465),
      pasta('Grilled Pasta (Half)', 400, 265),
      pasta('Grilled Pasta (Full)', 750, 465),
    ],
  },
  {
    category: 'Sandwiches',
    description: 'Paninis and club sandwiches',
    icon: '🥪',
    items: [
      sandwich('Mexican', 700, 410),
      sandwich('Club Sandwich', 400, 387),
      sandwich('Tikka Panini', 550, 362),
      sandwich('Malai Panini', 550, 362),
      sandwich('Special Panini', 600, 362),
      sandwich('Grilled Panini', 600, 362),
    ],
  },
  {
    category: 'Fried Chicken',
    description: 'Bone-in fried chicken',
    icon: '🍗',
    items: [
      chicken('Fried Chicken (2 pcs)', 550, 471),
      chicken('Fried Chicken (4 pcs)', 950, 940),
    ],
  },
  {
    category: 'Pizza — Traditional',
    description: 'Classic flavours in four sizes',
    icon: '🍕',
    items: sized(TRADITIONAL, [
      ['S', 650, 350], ['M', 1200, 566], ['L', 1700, 832], ['XL', 2100, 1340],
    ], '🍕'),
  },
  {
    category: 'Pizza — Special',
    description: 'Premium flavours in four sizes',
    icon: '🍕',
    items: sized(SPECIAL, [
      ['S', 750, 450], ['M', 1300, 633], ['L', 1800, 922], ['XL', 2350, 1420],
    ], '🍕'),
  },
  {
    category: 'Stuffed Pizza',
    description: 'Stuffed-crust pizzas',
    icon: '🍕',
    items: sized(STUFFED, [
      ['M', 1350, 783], ['L', 1850, 1072], ['XL', 2400, 1570],
    ], '🍕'),
  },
  {
    category: 'Doner Pizza',
    description: 'Doner-style pizza',
    icon: '🍕',
    items: [
      pizza('Doner Pizza (M)', 1400, 783),
      pizza('Doner Pizza (L)', 1850, 1072),
      pizza('Doner Pizza (XL)', 2300, 1570),
    ],
  },
  {
    category: 'Dip Sauces',
    description: 'All dips Rs 80',
    icon: '🍯',
    items: DIPS.map((name) => dip(`${name} Dip`, 80, 40)),
  },
  {
    category: 'Premium',
    description: 'Rolls, calzone, pide and platters',
    icon: '🥙',
    items: [
      wrap('Bihari Roll', 650, 532),
      sandwich('Steaker Sandwich', 750, 397),
      pizza('Calzone Chunk', 1000, 660),
      item('🫓')('Pide (Turkish Flat Bread)', 950, 666),
      item('🍢')('Kebabish Double Treat (M)', 1200, 933),
      item('🍢')('Kebabish Double Treat (L)', 1800, 1222),
      item('🍢')('Kebabish Double Treat (XL)', 2500, 1720),
    ],
  },
  {
    category: 'Boxes',
    description: 'Loaded sharing boxes',
    icon: '🍱',
    items: [
      combo('🍱')(
        'Snack Fuel Box',
        2100,
        '8 pc wings, 6 pc chicken strips, large fries, 6 pc nuggets, jumbo zinger',
        1419.5,
      ),
    ],
  },
  {
    category: 'Regular Deals',
    description: 'Everyday combo deals',
    icon: '🍕',
    items: [
      combo('🍕')('Regular Deal 1', 1000, 'Small pizza (traditional) + regular fries + 1 litre drink', 660),
      combo('🍕')('Regular Deal 2', 1550, '2 mini zingers + small pizza (traditional) + 5 wings + large fries + 1 litre drink', 1492),
      combo('🍔')('Regular Deal 3', 1250, '2 jumbo zingers + 5 wings + 2 NR drinks', 1014),
      combo('🍕')('Regular Deal 4', 1900, '1 medium pizza (traditional) + Mexican sandwich + 1 litre drink', 1120),
      combo('🍕')('Regular Deal 5', 2350, '1 large pizza (special) + 1 small pasta + regular fries + 1.5 litre drink', 1507),
      combo('🍔')('Regular Deal 6', 1550, '2 mini zingers + 2 jumbo zingers + 1.5 litre drink', 1450),
    ],
  },
  {
    category: 'Family Deals',
    description: 'Large combos for sharing',
    icon: '🍕',
    items: [
      combo('🍕')('Family Deal 1', 4650, '2 large pizzas (1 special, 1 traditional) + 4 mini zingers + large fries + 1.5 litre drink', 3348),
      combo('🍕')('Family Deal 2', 3750, '2 large pizzas (special) + large fries + 1.5 litre drink', 2234),
      combo('🍕')('Family Deal 3', 3400, '1 large pizza (any) + 10 crunchy wings + 2 jumbo zingers + large fries + 1.5 litre drink', 2276),
    ],
  },
  {
    category: 'Kids Deals',
    description: 'Smaller combos for kids',
    icon: '🍗',
    items: [
      combo('🍗')('Kids Deal 1', 500, '6 pc nuggets + regular fries + 1 NR drink', 486),
      combo('🍔')('Kids Deal 2', 880, '6 pc nuggets + 1 patty burger + regular fries + 2 NR drinks', 811),
      combo('🍗')('Kids Deal 3', 1450, '6 pc nuggets + 6 wings + 2 patty burgers + large fries + 1 litre drink', 1308),
    ],
  },
  {
    category: 'Drinks',
    description: 'Bottles, cans and water',
    icon: '🥤',
    items: [
      soda('NR Coke', 100),
      soda('1L Coke', 180),
      soda('1.5L Coke', 230),
      soda('NR Sprite', 100),
      soda('1L Sprite', 180),
      soda('1.5L Sprite', 230),
      water('Small Water', 50),
      water('Large Water', 100),
      soda('Can', 130),
      // Costed on its own, not at DRINK_COST_RATIO.
      item('🥛')('Glass', 10, 5),
    ],
  },
  {
    category: 'Add-Ons',
    description: 'Extras and toppings',
    icon: '📦',
    items: [
      addon('Cheese Slice', 80, 48),
      addon('Extra Toppings (S)', 150, 90),
      addon('Extra Toppings (M)', 280, 168),
      addon('Extra Toppings (L)', 350, 210),
      addon('Extra Toppings (XL)', 400, 240),
      addon('Dinner Roll', 50, 30),
    ],
  },
];

/**
 * Names an existing store may still hold for a row that the menu now calls
 * something else. The sync script renames these in place so the row — and
 * every order line that references it — survives.
 */
export const RENAMES: Record<string, string> = {
  'NR Bottle': 'NR Coke',
  '1 Litre Bottle': '1L Coke',
  '1.5 Litre Bottle': '1.5L Coke',
};

/**
 * The long size suffixes the menu used before it was shortened, so a row
 * named "Tikka (Small)" is recognised as today's "Tikka (S)".
 */
export function legacyName(name: string): string {
  return name
    .replace(/\(S\)$/, '(Small)')
    .replace(/\(M\)$/, '(Medium)')
    .replace(/\(L\)$/, '(Large)');
}

export const norm = (name: string) => name.trim().toLowerCase();

/** Finds the row for a menu item under its current name, its old size label, or its old name. */
export function findProduct<T extends { name: string }>(rows: T[], item: Item): T | undefined {
  const candidates = [item.name, legacyName(item.name)];
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    if (newName === item.name) candidates.push(oldName);
  }
  for (const candidate of candidates) {
    const hit = rows.find((p) => norm(p.name) === norm(candidate));
    if (hit) return hit;
  }
  return undefined;
}

export const TOTAL_ITEMS = MENU.reduce((sum, g) => sum + g.items.length, 0);

/** Items with a cost of their own; the rest fall back to COST_RATIO. */
export const COSTED_ITEMS = MENU.reduce(
  (sum, g) => sum + g.items.filter((row) => row.cost !== undefined).length,
  0,
);

// Fail loudly at load rather than writing an icon nobody can re-pick.
for (const group of MENU) {
  if (!SHELF.has(group.icon)) throw new Error(`Category "${group.category}" icon ${group.icon} is not on the shelf`);
  for (const row of group.items) {
    if (!SHELF.has(row.icon)) throw new Error(`Product "${row.name}" icon ${row.icon} is not on the shelf`);
  }
}
