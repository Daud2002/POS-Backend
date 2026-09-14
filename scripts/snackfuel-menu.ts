/**
 * The Snack Fuel menu, as printed — one definition shared by the seeder
 * (`seed-snackfuel.ts`, which builds a store from scratch) and the sync script
 * (`sync-snackfuel-menu.ts`, which brings an existing store into line).
 *
 * Order matters: categories are numbered 1..N and products 1..M in the order
 * they appear here, and that is the order the till shows them in. Icons are
 * emojis from the same shelf the product form offers, so every one of them is
 * also pickable by hand afterwards.
 */

export interface Item {
  name: string;
  price: number;
  /** Shelf emoji, stored in `products.image`. */
  icon: string;
  description?: string;
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

/** Cost = price × COST_RATIO. The printed menu carries no cost data. */
export const COST_RATIO = 0.75;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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
  sizes: Array<[label: string, price: number]>,
  icon: string,
): Item[] {
  const rows: Item[] = [];
  for (const flavour of flavours) {
    for (const [label, price] of sizes) {
      rows.push({ name: `${flavour} (${label})`, price, icon });
    }
  }
  return rows;
}

const item = (icon: string) => (name: string, price: number, description?: string): Item =>
  description ? { name, price, icon, description } : { name, price, icon };

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
const bento = item('🍱');
const soda = item('🥤');
const water = item('🧊');
const addon = item('📦');

export const MENU: Group[] = [
  {
    category: 'Appetizers',
    description: 'Fries, wings, nuggets and sides',
    icon: '🍟',
    items: [
      fries('Regular Fries (S)', 220),
      fries('Regular Fries (L)', 270),
      fries('Masala Fries', 230),
      fries('Garlic Mayo Fries', 250),
      fries('Loaded Fries', 550),
      chicken('Nuggets (6 pcs)', 290),
      chicken('Nuggets (12 pcs)', 550),
      chicken('Crunchy Wings (6 pcs)', 380),
      chicken('Crunchy Wings (12 pcs)', 680),
      chicken('Oven Baked Wings (6 pcs)', 400),
      chicken('Oven Baked Wings (12 pcs)', 750),
      chicken('Honey BBQ Wings (6 pcs)', 400),
      chicken('Honey BBQ Wings (12 pcs)', 750),
      cheese('Cheese Sticks', 500),
      cheese('Chicken Cheese Sticks', 650),
      chicken('Chicken Strips (4 pcs)', 300),
      item('🧆')('Spin Rolls', 650),
    ],
  },
  {
    category: 'Burgers',
    description: 'Chicken burgers and zingers',
    icon: '🍔',
    items: [
      burger('Patty Burger (Single)', 300),
      burger('Patty Burger (Double)', 450),
      burger('Fillet Grilled (Single)', 500),
      burger('Fillet Grilled (Double)', 750),
      burger('Zinger Mini', 300),
      burger('Zinger Jumbo', 450),
      burger('Big Bite Zinger', 700),
      burger('Tender Fillet', 550),
    ],
  },
  {
    category: 'Beef Burgers',
    description: 'Smash and classic beef burgers',
    icon: '🥩',
    items: [
      beef('Classic', 520),
      beef('Smash (Single)', 600),
      beef('Smash (Double)', 800),
      beef('Smash Onion', 650),
      beef('Beef Mexican', 650),
    ],
  },
  {
    category: 'Wraps',
    description: 'Rolls and tortilla wraps',
    icon: '🌯',
    items: [
      wrap('SF Special', 650),
      wrap('Twister', 550),
      wrap('Grilled', 550),
      wrap('Tortilla', 520),
    ],
  },
  {
    category: 'Pasta',
    description: 'Half and full portions',
    icon: '🍝',
    items: [
      pasta('SF Special (Half)', 400),
      pasta('SF Special (Full)', 750),
      pasta('Creamy Pasta (Half)', 350),
      pasta('Creamy Pasta (Full)', 650),
      pasta('Crunchy Pasta (Half)', 400),
      pasta('Crunchy Pasta (Full)', 750),
      pasta('Grilled Pasta (Half)', 400),
      pasta('Grilled Pasta (Full)', 750),
    ],
  },
  {
    category: 'Sandwiches',
    description: 'Paninis and club sandwiches',
    icon: '🥪',
    items: [
      sandwich('Mexican', 700),
      sandwich('Club Sandwich', 400),
      sandwich('Tikka Panini', 550),
      sandwich('Malai Panini', 550),
      sandwich('Special Panini', 600),
      sandwich('Grilled Panini', 600),
    ],
  },
  {
    category: 'Fried Chicken',
    description: 'Bone-in fried chicken',
    icon: '🍗',
    items: [
      chicken('Fried Chicken (2 pcs)', 550),
      chicken('Fried Chicken (4 pcs)', 950),
    ],
  },
  {
    category: 'Pizza — Traditional',
    description: 'Classic flavours in four sizes',
    icon: '🍕',
    items: sized(TRADITIONAL, [
      ['S', 650], ['M', 1200], ['L', 1700], ['XL', 2100],
    ], '🍕'),
  },
  {
    category: 'Pizza — Special',
    description: 'Premium flavours in four sizes',
    icon: '🍕',
    items: sized(SPECIAL, [
      ['S', 750], ['M', 1300], ['L', 1800], ['XL', 2350],
    ], '🍕'),
  },
  {
    category: 'Stuffed Pizza',
    description: 'Stuffed-crust pizzas',
    icon: '🍕',
    items: sized(STUFFED, [
      ['M', 1350], ['L', 1850], ['XL', 2400],
    ], '🍕'),
  },
  {
    category: 'Doner Pizza',
    description: 'Doner-style pizza',
    icon: '🍕',
    items: [
      pizza('Doner Pizza (M)', 1400),
      pizza('Doner Pizza (L)', 1850),
      pizza('Doner Pizza (XL)', 2300),
    ],
  },
  {
    category: 'Dip Sauces',
    description: 'All dips Rs 80',
    icon: '🍯',
    items: DIPS.map((name) => dip(`${name} Dip`, 80)),
  },
  {
    category: 'Premium',
    description: 'Rolls, calzone, pide and platters',
    icon: '🥙',
    items: [
      wrap('Bihari Roll', 650),
      sandwich('Steaker Sandwich', 750),
      pizza('Calzone Chunk', 1000),
      item('🫓')('Pide (Turkish Flat Bread)', 950),
      item('🍢')('Kebabish Double Treat (M)', 1200),
      item('🍢')('Kebabish Double Treat (L)', 1800),
      item('🍢')('Kebabish Double Treat (XL)', 2500),
    ],
  },
  {
    category: 'Boxes',
    description: 'Loaded sharing boxes',
    icon: '🍱',
    items: [
      bento(
        'Snack Fuel Box',
        2100,
        '8 pc wings, 6 pc chicken strips, large fries, 6 pc nuggets, jumbo zinger',
      ),
    ],
  },
  {
    category: 'Regular Deals',
    description: 'Everyday combo deals',
    icon: '🍕',
    items: [
      pizza('Regular Deal 1', 1000, 'Small pizza (traditional) + regular fries + 1 litre drink'),
      pizza('Regular Deal 2', 1550, '2 mini zingers + small pizza (traditional) + 5 wings + large fries + 1 litre drink'),
      burger('Regular Deal 3', 1250, '2 jumbo zingers + 5 wings + 2 NR drinks'),
      pizza('Regular Deal 4', 1900, '1 medium pizza (traditional) + Mexican sandwich + 1 litre drink'),
      pizza('Regular Deal 5', 2350, '1 large pizza (special) + 1 small pasta + regular fries + 1.5 litre drink'),
      burger('Regular Deal 6', 1550, '2 mini zingers + 2 jumbo zingers + 1.5 litre drink'),
    ],
  },
  {
    category: 'Family Deals',
    description: 'Large combos for sharing',
    icon: '🍕',
    items: [
      pizza('Family Deal 1', 4650, '2 large pizzas (1 special, 1 traditional) + 4 mini zingers + large fries + 1.5 litre drink'),
      pizza('Family Deal 2', 3750, '2 large pizzas (special) + large fries + 1.5 litre drink'),
      pizza('Family Deal 3', 3400, '1 large pizza (any) + 10 crunchy wings + 2 jumbo zingers + large fries + 1.5 litre drink'),
    ],
  },
  {
    category: 'Kids Deals',
    description: 'Smaller combos for kids',
    icon: '🍗',
    items: [
      chicken('Kids Deal 1', 500, '6 pc nuggets + regular fries + 1 NR drink'),
      burger('Kids Deal 2', 880, '6 pc nuggets + 1 patty burger + regular fries + 2 NR drinks'),
      chicken('Kids Deal 3', 1450, '6 pc nuggets + 6 wings + 2 patty burgers + large fries + 1 litre drink'),
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
    ],
  },
  {
    category: 'Add-Ons',
    description: 'Extras and toppings',
    icon: '📦',
    items: [
      addon('Cheese Slice', 80),
      addon('Extra Toppings (S)', 150),
      addon('Extra Toppings (M)', 280),
      addon('Extra Toppings (L)', 350),
      addon('Extra Toppings (XL)', 400),
      addon('Dinner Roll', 50),
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

export const TOTAL_ITEMS = MENU.reduce((sum, g) => sum + g.items.length, 0);

// Fail loudly at load rather than writing an icon nobody can re-pick.
for (const group of MENU) {
  if (!SHELF.has(group.icon)) throw new Error(`Category "${group.category}" icon ${group.icon} is not on the shelf`);
  for (const row of group.items) {
    if (!SHELF.has(row.icon)) throw new Error(`Product "${row.name}" icon ${row.icon} is not on the shelf`);
  }
}
