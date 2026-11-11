/**
 * What syncs between the cloud and a store server, and who wins.
 *
 * This file is the single source for the change-capture triggers
 * (sql/generate.ts writes them into a migration) and for the apply side
 * (shared/apply.service.ts). Changing it needs a new trigger migration:
 * `npm run sync:migration -- <Name>`; sync.config.spec.ts fails until then.
 *
 * Model, in short:
 * - A row is split into column GROUPS. Each group has its own "last edited
 *   at / by" stamp in `sync_meta`, so the newest edit wins per group: a sale
 *   bumping a store's order counter cannot overwrite the owner's change to
 *   its currency, even though both live in the `stores` row.
 * - Each group has an OWNER:
 *     both  — edited in either place, newest edit wins (menu, staff...).
 *     shop  — written only by the store server once a store is in server
 *             mode; the cloud refuses to write it (orders, tables, shifts).
 *     cloud — platform fields only the cloud may set (plan, subscription,
 *             operation mode, login email and role).
 * - COUNTERS (stock, quantities, totals) are never "newest wins": every
 *   change is recorded as a +/- delta and each delta is applied exactly once
 *   on the other side, so a sale in the shop and a stock-in at home add up.
 * - CHILDREN (order lines, recipe lines) have no timestamps of their own and
 *   are rewritten with fresh ids, so they travel inside their parent's group
 *   and are replaced as a set.
 */

export type Owner = 'both' | 'shop' | 'cloud';

export interface SyncGroup {
  columns: string[];
  owner: Owner;
  /** Child rows replaced as a set whenever this group is applied. */
  children?: { table: string; foreignKey: string };
}

export interface SyncTable {
  /** Physical table, and the `tbl` in sync_meta. */
  table: string;
  /**
   * How a row finds its store: a column of the row, or a PL/pgSQL
   * expression over the trigger row `r` (NEW, or OLD for a delete).
   */
  store: { column: string } | { sql: string };
  groups: Record<string, SyncGroup>;
  counters?: string[];
  /** Columns written along with every applied group but never compared. */
  touch?: string[];
  /** Inserted once, never updated: synced as single-group facts. */
  appendOnly?: boolean;
  /** Only ever travels shop → cloud (the cloud does not capture it). */
  upOnly?: boolean;
  /**
   * Another row whose groups must be re-stamped when this one is inserted,
   * because its store only became knowable now (a user's store is found
   * through the employee row created after it).
   */
  alsoTouch?: { table: string; idColumn: string };
}

const STAMPS = ['updatedAt'];

/** Apply order: parents before children, so foreign keys hold. Deletes run in reverse. */
export const SYNC_TABLES: SyncTable[] = [
  {
    table: 'users',
    store: {
      sql: `COALESCE(
        (SELECT s.id FROM stores s WHERE s."userId" = r.id),
        (SELECT e."storeId" FROM employee_details e WHERE e."userId" = r.id))`,
    },
    groups: {
      profile: { columns: ['name', 'phone', 'passwordHash'], owner: 'both' },
      status: { columns: ['isActive'], owner: 'both' },
      identity: { columns: ['email', 'role'], owner: 'cloud' },
    },
    touch: STAMPS,
  },
  {
    table: 'stores',
    store: { sql: 'r.id' },
    groups: {
      settings: {
        columns: [
          'name',
          'type',
          'address',
          'phone',
          'email',
          'currency',
          'printerConfig',
          'shiftsEnabled',
          'tipsCashEnabled',
          'tipsCardEnabled',
          'tipsOnlineEnabled',
          'tipsPaidFromCash',
        ],
        owner: 'both',
      },
      logo: { columns: ['logoUrl', 'logoData', 'logoMimeType'], owner: 'both' },
      ops: { columns: ['orderSequence', 'orderSequenceDay'], owner: 'shop' },
      platform: {
        columns: [
          'userId',
          'accountType',
          'plan',
          'subscriptionExpiresAt',
          'operationMode',
          'writerServerId',
          'writerEpoch',
        ],
        owner: 'cloud',
      },
    },
    touch: STAMPS,
    alsoTouch: { table: 'users', idColumn: 'userId' },
  },
  {
    table: 'employee_details',
    store: { column: 'storeId' },
    groups: {
      row: {
        columns: [
          'storeId',
          'userId',
          'employeeId',
          'name',
          'email',
          'phone',
          'address',
          'salary',
          'joinDate',
          'designation',
          'printerName',
          'permissions',
        ],
        owner: 'both',
      },
    },
    touch: STAMPS,
    alsoTouch: { table: 'users', idColumn: 'userId' },
  },
  {
    table: 'expense_categories',
    store: { column: 'storeId' },
    groups: { row: { columns: ['storeId', 'name', 'description', 'isActive'], owner: 'both' } },
    touch: STAMPS,
  },
  {
    // After its category, before the expenses that point at it.
    table: 'expense_subcategories',
    store: { column: 'storeId' },
    groups: { row: { columns: ['storeId', 'categoryId', 'name', 'isActive'], owner: 'both' } },
    touch: STAMPS,
  },
  {
    table: 'categories',
    store: { column: 'storeId' },
    groups: {
      row: {
        columns: ['storeId', 'name', 'description', 'image', 'isActive', 'sortOrder', 'skipKitchen'],
        owner: 'both',
      },
    },
    touch: STAMPS,
  },
  {
    table: 'inventory_items',
    store: { column: 'storeId' },
    groups: {
      row: {
        columns: ['storeId', 'name', 'unit', 'packSize', 'lowStockThreshold', 'isActive'],
        owner: 'both',
      },
    },
    counters: ['quantity'],
    touch: STAMPS,
  },
  {
    table: 'products',
    store: { column: 'storeId' },
    groups: {
      row: {
        columns: [
          'storeId',
          'name',
          'description',
          'price',
          'costPrice',
          'lowStockAlertQuantity',
          'sku',
          'barcode',
          'image',
          'isActive',
          'sortOrder',
          'categoryId',
        ],
        owner: 'both',
      },
      recipe: { columns: [], owner: 'both', children: { table: 'product_ingredients', foreignKey: 'productId' } },
    },
    counters: ['stock'],
    touch: STAMPS,
  },
  {
    table: 'customers',
    store: { column: 'storeId' },
    groups: {
      row: { columns: ['storeId', 'name', 'email', 'phone', 'address', 'city', 'isActive'], owner: 'both' },
    },
    counters: ['totalSpent'],
    touch: STAMPS,
  },
  {
    table: 'restaurant_tables',
    store: { column: 'storeId' },
    groups: {
      config: { columns: ['storeId', 'name', 'isActive'], owner: 'both' },
      // Which order sits at a table is service state: only the shop writes it.
      state: { columns: ['status', 'currentOrderId'], owner: 'shop' },
    },
    touch: STAMPS,
  },
  {
    table: 'cashier_shifts',
    store: { column: 'storeId' },
    groups: {
      // Opening, closing and collecting a drawer all happen at the till.
      row: {
        columns: [
          'storeId',
          'userId',
          'status',
          'openedAt',
          'openingFloat',
          'closedAt',
          'closedById',
          'cashSales',
          'cardSales',
          'onlineSales',
          'otherSales',
          'totalSales',
          'orderCount',
          'cashPaidOut',
          'cashTips',
          'cardTips',
          'onlineTips',
          'tipsFromDrawer',
          'tipBreakdown',
          'expectedCash',
          'countedCash',
          'difference',
          'closingNotes',
          'collectedAmount',
          'collectedById',
          'collectedAt',
          'collectionNotes',
        ],
        owner: 'shop',
      },
    },
    touch: STAMPS,
  },
  {
    table: 'orders',
    store: { column: 'storeId' },
    groups: {
      row: {
        columns: [
          'storeId',
          'orderNumber',
          'orderSequence',
          'customerId',
          'customerName',
          'customerPhone',
          'deliveryAddress',
          'createdById',
          'settledById',
          'settledAt',
          'shiftId',
          'creditedAt',
          'creditedById',
          'billPrintedById',
          'billPrintedAt',
          'riderName',
          'billPrintCount',
          'status',
          'orderStatus',
          'orderType',
          'tableId',
          'subtotal',
          'tax',
          'discount',
          'discountType',
          'discountValue',
          'deliveryCharge',
          'total',
          'notes',
          'paymentMethod',
          'paidCash',
          'paidCard',
          'paidOnline',
          'tipAmount',
          'tipMethod',
          'version',
        ],
        owner: 'shop',
        children: { table: 'order_items', foreignKey: 'orderId' },
      },
    },
    touch: STAMPS,
  },
  {
    table: 'order_events',
    store: { column: 'storeId' },
    groups: {
      row: {
        columns: ['orderId', 'storeId', 'type', 'actorId', 'actorName', 'actorRole', 'payload'],
        owner: 'shop',
      },
    },
    appendOnly: true,
  },
  {
    table: 'inventory_movements',
    store: { column: 'storeId' },
    groups: {
      row: {
        columns: ['storeId', 'inventoryItemId', 'type', 'quantity', 'orderId', 'note', 'createdById'],
        owner: 'both',
      },
    },
    appendOnly: true,
  },
  {
    table: 'expenses',
    store: { column: 'storeId' },
    groups: {
      row: {
        columns: [
          'storeId',
          'categoryId',
          'subcategoryId',
          'title',
          'amount',
          'expenseDate',
          'paymentMethod',
          'notes',
          'createdById',
          'shiftId',
        ],
        owner: 'both',
      },
    },
    touch: STAMPS,
  },
  {
    table: 'audit_logs',
    store: { column: 'storeId' },
    groups: {
      row: {
        columns: [
          'storeId',
          'actorId',
          'actorName',
          'actorRole',
          'impersonatorId',
          'module',
          'action',
          'entityType',
          'entityId',
          'summary',
          'method',
          'path',
          'statusCode',
          'payload',
          'ip',
          'userAgent',
        ],
        owner: 'shop',
      },
    },
    appendOnly: true,
    upOnly: true,
  },
];

/** Child tables, by name: their own triggers re-stamp the parent group. */
export const SYNC_CHILDREN = SYNC_TABLES.flatMap((t) =>
  Object.entries(t.groups)
    .filter(([, g]) => g.children)
    .map(([grp, g]) => ({ parent: t, group: grp, ...g.children! })),
);

export const syncTable = (table: string): SyncTable => {
  const found = SYNC_TABLES.find((t) => t.table === table);
  if (!found) throw new Error(`Not a synced table: ${table}`);
  return found;
};
