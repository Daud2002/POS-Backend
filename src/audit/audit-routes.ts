/**
 * Turns a raw HTTP write into the one line the platform admin reads.
 *
 * Pure on purpose — no Nest, no database — so the mapping can be unit-tested
 * against fake requests. The interceptor hands in the method, the Express
 * route PATTERN (not the concrete URL), the params, the body, the handler's
 * return value and the signed-in user; this decides the module, the action,
 * the summary, which store it belongs to and what (sanitised) payload to keep.
 *
 * Routes missing from the table are still logged, under their method and
 * pattern, so a handler added next month is never silently invisible.
 */

export interface AuditActor {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  effectiveRole?: string | null;
  storeId?: string | null;
  impersonatedBy?: { id: string; name?: string | null } | null;
}

export interface AuditContext {
  method: string;
  /** Route pattern with the global prefix removed, e.g. '/restaurant/orders/:id/punch'. */
  routePath: string;
  params: Record<string, string | undefined>;
  body: unknown;
  response: unknown;
  user: AuditActor | null;
  /** Multer metadata for multipart routes; the bytes themselves are never passed. */
  file?: { mimetype?: string; size?: number; originalname?: string } | null;
}

export interface AuditDescription {
  module: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  storeId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  impersonatorId: string | null;
  payload: Record<string, unknown> | null;
}

interface AuditRoute {
  module: string;
  action: string | ((ctx: AuditContext) => string);
  entityType?: string;
  /** Logged nowhere: refresh churn, or bodies that are secrets end to end. */
  skip?: boolean;
  /** Where the store comes from when the actor has none (the platform admin). */
  storeIdFrom?: 'params.id' | 'params.storeId' | 'response.id' | 'response.store.id';
  /** The actor is in the response, not on the request (signing in). */
  actorFromResponse?: boolean;
  summary?: (ctx: AuditContext) => string;
  /** Override what is kept; `() => null` keeps nothing. */
  payload?: (ctx: AuditContext) => Record<string, unknown> | null;
}

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const SUMMARY_MAX_LENGTH = 300;
export const PAYLOAD_MAX_BYTES = 8192;

/** Keys whose values must never reach the audit table, wherever they sit. */
export const REDACTED_KEY = /password|token|secret|authorization|signature/i;

// ---------------------------------------------------------------------------
// Small readers. Every one tolerates garbage: a summary must never throw.
// ---------------------------------------------------------------------------

function rec(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function str(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = num(value);
  return n === null ? '?' : n.toFixed(2);
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function quoted(value: unknown, fallback: string): string {
  const s = str(value);
  return s ? `"${s}"` : fallback;
}

/** How a restaurant order is referred to on the floor. */
function orderLabel(ctx: AuditContext): string {
  const order = rec(ctx.response);
  const sequence = num(order.orderSequence);
  if (sequence !== null && sequence > 0) return `#${sequence}`;
  const number = str(order.orderNumber);
  if (number) return number;
  const id = str(ctx.params?.id ?? order.id);
  return id ? id.slice(0, 8) : '';
}

function discountPhrase(source: Record<string, any>): string {
  const value = num(source.discountValue);
  if (value === null || value <= 0) return '';
  return source.discountType === 'percent' ? ` with ${value}% discount` : ` with ${money(value)} discount`;
}

function deliveryPhrase(source: Record<string, any>): string {
  const charge = num(source.deliveryCharge);
  return charge !== null && charge > 0 ? `, delivery charge ${money(charge)}` : '';
}

function tablePhrase(ctx: AuditContext): string {
  const order = rec(ctx.response);
  const tableName = str(rec(order.table).name);
  if (tableName) return ` at ${tableName}`;
  return str(order.tableId) ? ' at a table' : '';
}

function orderTypePhrase(ctx: AuditContext): string {
  const type = str(rec(ctx.response).orderType ?? rec(ctx.body).orderType);
  return type && type !== 'none' ? type.replace('_', '-') : 'order';
}

function changedFields(body: unknown): string {
  const keys = Object.keys(rec(body)).filter((k) => !REDACTED_KEY.test(k));
  return keys.length ? ` (${keys.join(', ')})` : '';
}

function nameOf(ctx: AuditContext, fallback: string): string {
  return quoted(rec(ctx.body).name ?? rec(ctx.response).name, fallback);
}

function activation(ctx: AuditContext, noun: string): string | null {
  const active = rec(ctx.body).isActive;
  if (active === true) return `${noun}.activated`;
  if (active === false) return `${noun}.deactivated`;
  return null;
}

// ---------------------------------------------------------------------------
// The table. Keys are `${METHOD} ${routePath}` with the global prefix removed.
// ---------------------------------------------------------------------------

const ROUTES: Record<string, AuditRoute> = {
  // --- auth ---------------------------------------------------------------
  'POST /auth/login': {
    module: 'auth',
    action: 'auth.login',
    entityType: 'user',
    actorFromResponse: true,
    summary: (ctx) => {
      const user = rec(rec(ctx.response).user);
      return `${str(user.name, str(user.email, 'User'))} signed in`;
    },
    payload: () => null,
  },
  'POST /auth/change-password': {
    module: 'auth',
    action: 'auth.password_changed',
    entityType: 'user',
    summary: () => 'Changed their password',
    payload: () => null,
  },
  'POST /auth/impersonation-links': {
    module: 'auth',
    action: 'impersonation.link_issued',
    entityType: 'user',
    summary: (ctx) => {
      const target = rec(rec(ctx.response).target);
      const who = str(target.name, str(rec(ctx.body).targetUserId, 'a user'));
      const store = str(target.storeName);
      return `Impersonation link issued for ${who}${store ? ` (${store})` : ''}`;
    },
    payload: (ctx) => ({
      targetUserId: str(rec(ctx.body).targetUserId) || null,
      expiresAt: rec(ctx.response).expiresAt ?? null,
    }),
  },
  'POST /auth/refresh': { module: 'auth', action: 'auth.refresh', skip: true },
  'POST /auth/logout': { module: 'auth', action: 'auth.logout', skip: true },
  'POST /auth/register': { module: 'auth', action: 'auth.register', skip: true },
  // Logged by ImpersonationService itself, with the admin as actor.
  'POST /auth/impersonation-links/exchange': { module: 'auth', action: 'impersonation.started', skip: true },
  // One per receipt and the body is the thing being signed: pure noise.
  'POST /printing/qz/sign': { module: 'printing', action: 'printing.sign', skip: true },

  // --- restaurant orders ----------------------------------------------------
  'POST /restaurant/orders': {
    module: 'orders',
    entityType: 'order',
    action: (ctx) => (rec(ctx.body).isDraft ? 'order.draft_created' : 'order.created'),
    summary: (ctx) => {
      const body = rec(ctx.body);
      const order = rec(ctx.response);
      const label = orderLabel(ctx);
      const items = plural(count(body.items), 'item');
      if (body.isDraft) return `Draft ${label} saved (${orderTypePhrase(ctx)}${tablePhrase(ctx)}, ${items})`;
      return (
        `Order ${label} created (${orderTypePhrase(ctx)}${tablePhrase(ctx)}, ${items}, total ${money(order.total)})` +
        discountPhrase(body) +
        deliveryPhrase(body) +
        (body.printBill ? ', bill printed' : '')
      );
    },
  },
  'PATCH /restaurant/orders/:id/draft': {
    module: 'orders',
    action: 'order.draft_saved',
    entityType: 'order',
    summary: (ctx) => `Draft ${orderLabel(ctx)} updated (${plural(count(rec(ctx.body).items), 'item')})`,
    // Fires on every autosave; keep the shape, not the lines.
    payload: (ctx) => {
      const body = rec(ctx.body);
      return { lineCount: count(body.items), tableId: body.tableId ?? null, version: body.version ?? null };
    },
  },
  'DELETE /restaurant/orders/:id/draft': {
    module: 'orders',
    action: 'order.draft_discarded',
    entityType: 'order',
    summary: (ctx) => `Draft ${orderLabel(ctx)} discarded`,
  },
  'POST /restaurant/orders/:id/punch': {
    module: 'orders',
    action: 'order.punched',
    entityType: 'order',
    summary: (ctx) => {
      const order = rec(ctx.response);
      return (
        `Order ${orderLabel(ctx)} punched to kitchen (${plural(count(order.items), 'item')}, total ${money(order.total)})` +
        discountPhrase(rec(ctx.body))
      );
    },
  },
  'POST /restaurant/orders/:id/items': {
    module: 'orders',
    action: 'order.items_added',
    entityType: 'order',
    summary: (ctx) => `${plural(count(rec(ctx.body).items), 'item')} added to order ${orderLabel(ctx)}`,
  },
  'POST /restaurant/orders/:id/items/remove': {
    module: 'orders',
    action: 'order.items_removed',
    entityType: 'order',
    summary: (ctx) => `${plural(count(rec(ctx.body).items), 'item')} removed from order ${orderLabel(ctx)}`,
  },
  'PATCH /restaurant/orders/:id/status': {
    module: 'orders',
    action: 'order.status_changed',
    entityType: 'order',
    summary: (ctx) =>
      `Order ${orderLabel(ctx)} marked ${str(rec(ctx.body).orderStatus, 'updated').replace('_', ' ')}`,
  },
  'POST /restaurant/orders/:id/print-bill': {
    module: 'orders',
    action: 'order.bill_printed',
    entityType: 'order',
    summary: (ctx) => {
      const order = rec(ctx.response);
      const prints = num(order.billPrintCount);
      return (
        `Bill printed for order ${orderLabel(ctx)} (total ${money(order.total)}` +
        (prints !== null && prints > 1 ? `, print #${prints}` : '') +
        ')' +
        discountPhrase(rec(ctx.body)) +
        deliveryPhrase(rec(ctx.body))
      );
    },
  },
  'POST /restaurant/orders/:id/settle': {
    module: 'orders',
    action: 'order.settled',
    entityType: 'order',
    summary: (ctx) => {
      const body = rec(ctx.body);
      const order = rec(ctx.response);
      const method = str(order.paymentMethod ?? body.paymentMethod, 'cash');
      return `Order ${orderLabel(ctx)} settled (${method}, total ${money(order.total)})` + discountPhrase(body);
    },
  },
  'POST /restaurant/orders/:id/cancel': {
    module: 'orders',
    action: 'order.cancelled',
    entityType: 'order',
    summary: (ctx) => `Order ${orderLabel(ctx)} cancelled`,
  },

  // --- restaurant tables ----------------------------------------------------
  'POST /restaurant/tables': {
    module: 'tables',
    action: 'table.created',
    entityType: 'table',
    summary: (ctx) => `Table ${nameOf(ctx, '')} created`.replace('  ', ' '),
  },
  'PATCH /restaurant/tables/:id': {
    module: 'tables',
    action: 'table.updated',
    entityType: 'table',
    summary: (ctx) => `Table ${nameOf(ctx, str(ctx.params.id).slice(0, 8))} updated${changedFields(ctx.body)}`,
  },
  'DELETE /restaurant/tables/:id': {
    module: 'tables',
    action: 'table.removed',
    entityType: 'table',
    summary: (ctx) => `Table ${str(ctx.params.id).slice(0, 8)} removed`,
  },

  // --- general POS orders ---------------------------------------------------
  'POST /orders': {
    module: 'orders',
    action: 'order.created',
    entityType: 'order',
    summary: (ctx) => {
      const order = rec(ctx.response);
      const body = rec(ctx.body);
      return (
        `Order ${str(order.orderNumber, 'created')} created (${plural(count(body.items), 'item')}, ` +
        `total ${money(order.total)}, ${str(order.status ?? body.status, 'unpaid')})` +
        (num(body.discount) > 0 ? ` with ${money(body.discount)} discount` : '')
      );
    },
  },
  'PATCH /orders/:id': {
    module: 'orders',
    action: 'order.updated',
    entityType: 'order',
    summary: (ctx) => `Order ${orderLabel(ctx)} updated${changedFields(ctx.body)}`,
  },
  'PATCH /orders/:id/mark-as-paid': {
    module: 'orders',
    action: 'order.paid',
    entityType: 'order',
    summary: (ctx) => `Order ${orderLabel(ctx)} marked as paid`,
  },
  'DELETE /orders/:id': {
    module: 'orders',
    action: 'order.deleted',
    entityType: 'order',
    summary: (ctx) => `Order ${str(ctx.params.id).slice(0, 8)} deleted`,
  },

  // --- catalogue ------------------------------------------------------------
  'POST /products': {
    module: 'products',
    action: 'product.created',
    entityType: 'product',
    summary: (ctx) => `Product ${nameOf(ctx, 'created')} created (price ${money(rec(ctx.body).price)})`,
  },
  'PATCH /products/:id': {
    module: 'products',
    action: (ctx) => activation(ctx, 'product') ?? 'product.updated',
    entityType: 'product',
    summary: (ctx) => `Product ${nameOf(ctx, str(ctx.params.id).slice(0, 8))} updated${changedFields(ctx.body)}`,
  },
  'DELETE /products/:id': {
    module: 'products',
    action: 'product.deleted',
    entityType: 'product',
    summary: (ctx) => `Product ${str(ctx.params.id).slice(0, 8)} deleted`,
  },
  'POST /categories': {
    module: 'categories',
    action: 'category.created',
    entityType: 'category',
    summary: (ctx) => `Category ${nameOf(ctx, 'created')} created`,
  },
  'PATCH /categories/:id': {
    module: 'categories',
    action: 'category.updated',
    entityType: 'category',
    summary: (ctx) => `Category ${nameOf(ctx, str(ctx.params.id).slice(0, 8))} updated${changedFields(ctx.body)}`,
  },
  'DELETE /categories/:id': {
    module: 'categories',
    action: 'category.deleted',
    entityType: 'category',
    summary: (ctx) => `Category ${str(ctx.params.id).slice(0, 8)} deleted`,
  },

  // --- customers ------------------------------------------------------------
  'POST /customers': {
    module: 'customers',
    action: 'customer.created',
    entityType: 'customer',
    summary: (ctx) => `Customer ${nameOf(ctx, 'added')} added`,
  },
  'PATCH /customers/:id': {
    module: 'customers',
    action: 'customer.updated',
    entityType: 'customer',
    summary: (ctx) => `Customer ${nameOf(ctx, str(ctx.params.id).slice(0, 8))} updated${changedFields(ctx.body)}`,
  },
  'DELETE /customers/:id': {
    module: 'customers',
    action: 'customer.deleted',
    entityType: 'customer',
    summary: (ctx) => `Customer ${str(ctx.params.id).slice(0, 8)} deleted`,
  },

  // --- inventory ------------------------------------------------------------
  'POST /inventory': {
    module: 'inventory',
    action: 'inventory.item_created',
    entityType: 'inventory_item',
    summary: (ctx) => {
      const body = rec(ctx.body);
      return `Inventory item ${nameOf(ctx, 'created')} created (${money(body.quantity)} ${str(body.unit)})`;
    },
  },
  'PATCH /inventory/:id': {
    module: 'inventory',
    action: 'inventory.item_updated',
    entityType: 'inventory_item',
    summary: (ctx) => `Inventory item ${nameOf(ctx, str(ctx.params.id).slice(0, 8))} updated${changedFields(ctx.body)}`,
  },
  'POST /inventory/:id/stock-in': {
    module: 'inventory',
    action: 'inventory.stock_in',
    entityType: 'inventory_item',
    summary: (ctx) => {
      const body = rec(ctx.body);
      const item = rec(ctx.response);
      return `Stock in: ${money(body.amount)}${body.inPacks ? ' packs' : ''} of ${quoted(item.name, 'item')}` +
        (str(body.note) ? ` — ${str(body.note)}` : '');
    },
  },
  'POST /inventory/:id/adjust': {
    module: 'inventory',
    action: 'inventory.adjusted',
    entityType: 'inventory_item',
    summary: (ctx) => {
      const body = rec(ctx.body);
      const item = rec(ctx.response);
      return `Stock of ${quoted(item.name, 'item')} adjusted to ${money(body.quantity)}` +
        (str(body.note) ? ` — ${str(body.note)}` : '');
    },
  },
  'DELETE /inventory/:id': {
    module: 'inventory',
    action: 'inventory.item_deleted',
    entityType: 'inventory_item',
    summary: (ctx) => `Inventory item ${str(ctx.params.id).slice(0, 8)} deleted`,
  },
  'PUT /inventory/recipes/:productId': {
    module: 'inventory',
    action: 'inventory.recipe_set',
    entityType: 'product',
    summary: (ctx) => `Recipe set (${plural(count(rec(ctx.body).ingredients), 'ingredient')})`,
  },

  // --- expenses -------------------------------------------------------------
  'POST /expenses': {
    module: 'expenses',
    action: 'expense.created',
    entityType: 'expense',
    summary: (ctx) => {
      const body = rec(ctx.body);
      return `Expense ${quoted(body.title, 'recorded')} of ${money(body.amount)} recorded`;
    },
  },
  'PATCH /expenses/:id': {
    module: 'expenses',
    action: 'expense.updated',
    entityType: 'expense',
    summary: (ctx) => `Expense ${quoted(rec(ctx.body).title, str(ctx.params.id).slice(0, 8))} updated${changedFields(ctx.body)}`,
  },
  'DELETE /expenses/:id': {
    module: 'expenses',
    action: 'expense.deleted',
    entityType: 'expense',
    summary: (ctx) => `Expense ${str(ctx.params.id).slice(0, 8)} deleted`,
  },
  'POST /expenses/categories': {
    module: 'expenses',
    action: 'expense_category.created',
    entityType: 'expense_category',
    summary: (ctx) => `Expense category ${nameOf(ctx, 'created')} created`,
  },
  'PATCH /expenses/categories/:id': {
    module: 'expenses',
    action: 'expense_category.updated',
    entityType: 'expense_category',
    summary: (ctx) => `Expense category ${nameOf(ctx, str(ctx.params.id).slice(0, 8))} updated${changedFields(ctx.body)}`,
  },
  'DELETE /expenses/categories/:id': {
    module: 'expenses',
    action: 'expense_category.deleted',
    entityType: 'expense_category',
    summary: (ctx) => `Expense category ${str(ctx.params.id).slice(0, 8)} deleted`,
  },

  // --- shifts ---------------------------------------------------------------
  'POST /shifts/open': {
    module: 'shifts',
    action: 'shift.opened',
    entityType: 'shift',
    summary: (ctx) => `Shift opened (float ${money(rec(ctx.body).openingFloat ?? 0)})`,
  },
  'POST /shifts/:id/close': {
    module: 'shifts',
    action: 'shift.closed',
    entityType: 'shift',
    summary: (ctx) => `Shift closed (counted cash ${money(rec(ctx.body).countedCash)})`,
  },
  'POST /shifts/:id/force-close': {
    module: 'shifts',
    action: 'shift.force_closed',
    entityType: 'shift',
    summary: (ctx) => `Shift force-closed by the owner${str(rec(ctx.body).notes) ? ` — ${str(rec(ctx.body).notes)}` : ''}`,
  },
  'POST /shifts/:id/collect': {
    module: 'shifts',
    action: 'shift.collected',
    entityType: 'shift',
    summary: (ctx) => `Shift cash collected (${money(rec(ctx.body).collectedAmount)})`,
  },

  // --- employees ------------------------------------------------------------
  'POST /employees/store/:storeId': {
    module: 'employees',
    action: 'employee.created',
    entityType: 'employee',
    storeIdFrom: 'params.storeId',
    summary: (ctx) => {
      const body = rec(ctx.body);
      return `Employee ${quoted(body.name, 'added')} added as ${str(body.designation, 'cashier')}`;
    },
  },
  'PATCH /employees/:id': {
    module: 'employees',
    action: (ctx) => activation(ctx, 'employee') ?? 'employee.updated',
    entityType: 'employee',
    summary: (ctx) => {
      const body = rec(ctx.body);
      const who = quoted(body.name ?? rec(ctx.response).name, str(ctx.params.id).slice(0, 8));
      if (body.isActive === false) return `Employee ${who} deactivated`;
      if (body.isActive === true) return `Employee ${who} activated`;
      return `Employee ${who} updated${changedFields(ctx.body)}`;
    },
  },
  'PATCH /employees/:id/permissions': {
    module: 'employees',
    action: 'employee.permissions_changed',
    entityType: 'employee',
    summary: (ctx) => {
      const permissions = rec(ctx.body).permissions;
      const list = Array.isArray(permissions) ? permissions.map(String).join(', ') : 'none';
      return `Permissions set to: ${list || 'none'}`;
    },
  },
  'DELETE /employees/:id': {
    module: 'employees',
    action: 'employee.deleted',
    entityType: 'employee',
    summary: (ctx) => `Employee ${str(ctx.params.id).slice(0, 8)} removed`,
  },

  // --- platform: users & stores --------------------------------------------
  'POST /users': {
    module: 'users',
    action: 'user.created',
    entityType: 'user',
    summary: (ctx) => {
      const body = rec(ctx.body);
      return `User ${quoted(body.name ?? body.email, 'created')} created as ${str(body.role, 'user')}`;
    },
  },
  'PUT /users/:id': {
    module: 'users',
    action: (ctx) => activation(ctx, 'user') ?? 'user.updated',
    entityType: 'user',
    summary: (ctx) => userSummary(ctx),
  },
  'PATCH /users/:id': {
    module: 'users',
    action: (ctx) => activation(ctx, 'user') ?? 'user.updated',
    entityType: 'user',
    summary: (ctx) => userSummary(ctx),
  },
  'DELETE /users/:id': {
    module: 'users',
    action: 'user.deleted',
    entityType: 'user',
    summary: (ctx) => `User ${str(ctx.params.id).slice(0, 8)} deleted`,
  },
  'POST /stores': {
    module: 'stores',
    action: 'store.created',
    entityType: 'store',
    storeIdFrom: 'response.id',
    summary: (ctx) => {
      const body = rec(ctx.body);
      return `Store ${quoted(body.name, 'created')} created (${str(body.accountType, 'general')}, ${str(body.plan, 'starter')} plan)`;
    },
  },
  'PATCH /stores/:id': {
    module: 'stores',
    action: 'store.updated',
    entityType: 'store',
    storeIdFrom: 'params.id',
    summary: (ctx) => `Store ${nameOf(ctx, '')} updated${changedFields(ctx.body)}`.replace('Store  ', 'Store '),
  },
  'PATCH /stores/:id/settings': {
    module: 'stores',
    action: 'store.settings_updated',
    entityType: 'store',
    storeIdFrom: 'params.id',
    summary: (ctx) => `Store settings updated${changedFields(ctx.body)}`,
  },
  'POST /stores/:id/logo': {
    module: 'stores',
    action: 'store.logo_uploaded',
    entityType: 'store',
    storeIdFrom: 'params.id',
    summary: (ctx) => `Store logo uploaded (${str(ctx.file?.mimetype, 'image')}, ${num(ctx.file?.size) ?? 0} bytes)`,
    payload: (ctx) => ({ mimetype: ctx.file?.mimetype ?? null, size: ctx.file?.size ?? null }),
  },
  'DELETE /stores/:id/logo': {
    module: 'stores',
    action: 'store.logo_removed',
    entityType: 'store',
    storeIdFrom: 'params.id',
    summary: () => 'Store logo removed',
  },
  'DELETE /stores/:id': {
    module: 'stores',
    action: 'store.deleted',
    entityType: 'store',
    storeIdFrom: 'params.id',
    summary: (ctx) => `Store ${str(ctx.params.id).slice(0, 8)} deleted with its owner and staff`,
  },
  'POST /stores/:id/subscription': {
    module: 'subscriptions',
    action: 'subscription.extended',
    entityType: 'store',
    storeIdFrom: 'params.id',
    summary: (ctx) => {
      const body = rec(ctx.body);
      const result = rec(ctx.response);
      const store = rec(result.store);
      const months = num(body.months);
      const until = str(store.subscriptionExpiresAt ?? rec(result.payment).newExpiresAt, '?');
      const how = months ? `extended by ${plural(months, 'month')}` : `set to ${str(body.expiresAt, until)}`;
      return `Subscription ${store.name ? `of ${quoted(store.name, '')} ` : ''}${how} → paid through ${until}` +
        (str(body.note) ? ` — ${str(body.note)}` : '');
    },
  },
};

function userSummary(ctx: AuditContext): string {
  const body = rec(ctx.body);
  const who = quoted(body.name ?? rec(ctx.response).name ?? rec(ctx.response).email, str(ctx.params.id).slice(0, 8));
  if (body.isActive === false) return `User ${who} deactivated`;
  if (body.isActive === true) return `User ${who} activated`;
  return `User ${who} updated${changedFields(ctx.body)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Strips the global prefix and any trailing slash so the table is prefix-agnostic. */
export function normalizeRoutePath(path: string): string {
  let p = String(path ?? '').split('?')[0].trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/^\/api(?=\/|$)/, '');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

/**
 * Rebuilds the route pattern from a concrete URL when Express did not attach
 * `req.route` — each param VALUE is swapped back for its `:name`.
 */
export function patternFromParams(path: string, params: Record<string, string | undefined>): string {
  let pattern = normalizeRoutePath(path);
  for (const [name, value] of Object.entries(params ?? {})) {
    if (!value) continue;
    pattern = pattern.split(`/${value}`).join(`/:${name}`);
  }
  return pattern;
}

export function resolveAuditRoute(method: string, routePath: string): AuditRoute {
  const key = `${method.toUpperCase()} ${normalizeRoutePath(routePath)}`;
  const known = ROUTES[key];
  if (known) return known;
  const normalized = normalizeRoutePath(routePath);
  const first = normalized.split('/').filter(Boolean)[0] ?? 'api';
  return { module: first.slice(0, 40), action: `${method.toUpperCase()} ${normalized}` };
}

/** Every module and action the table knows, for the filter dropdowns. */
export function knownAuditActions(): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const route of Object.values(ROUTES)) {
    if (route.skip || typeof route.action !== 'string') continue;
    (out[route.module] ??= new Set()).add(route.action);
  }
  // Actions produced by functions above, which the loop cannot see.
  for (const [module, actions] of Object.entries({
    orders: ['order.draft_created'],
    products: ['product.activated', 'product.deactivated'],
    employees: ['employee.activated', 'employee.deactivated'],
    users: ['user.activated', 'user.deactivated'],
    auth: ['impersonation.started'],
  })) {
    for (const action of actions) (out[module] ??= new Set()).add(action);
  }
  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, actions]) => [module, [...actions].sort()]),
  );
}

/**
 * A copy of `value` that is safe to keep: secrets redacted by key wherever
 * they sit, binary dropped, bounded in depth, width and total size.
 */
export function sanitizePayload(value: unknown, maxBytes = PAYLOAD_MAX_BYTES): Record<string, unknown> | null {
  const cleaned = clean(value, 0);
  if (cleaned === null || cleaned === undefined) return null;
  const wrapped = (
    typeof cleaned === 'object' && !Array.isArray(cleaned) ? cleaned : { value: cleaned }
  ) as Record<string, unknown>;
  if (Object.keys(wrapped).length === 0) return null;

  const serialized = JSON.stringify(wrapped);
  if (serialized.length <= maxBytes) return wrapped;
  return { _truncated: true, preview: serialized.slice(0, maxBytes) };
}

function clean(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return '[binary]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((v) => clean(v, depth + 1));
    return value.length > 50 ? [...items, `[+${value.length - 50} more]`] : items;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'file' || key === 'files') continue;
      out[key] = REDACTED_KEY.test(key) ? '[redacted]' : clean(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * The audit row for one successful write, or null when nothing should be
 * kept (a read, a skipped route, or no actor to attribute it to).
 */
export function describeRequest(ctx: AuditContext): AuditDescription | null {
  const method = String(ctx.method ?? '').toUpperCase();
  if (!MUTATING_METHODS.has(method)) return null;

  const route = resolveAuditRoute(method, ctx.routePath);
  if (route.skip) return null;

  const actor: AuditActor | null = route.actorFromResponse
    ? (rec(rec(ctx.response).user) as AuditActor)
    : ctx.user;
  if (!actor || !actor.id) return null;

  const params = ctx.params ?? {};
  const response = rec(ctx.response);
  const body = rec(ctx.body);

  let storeId: string | null = str(actor.storeId) || null;
  if (!storeId) {
    switch (route.storeIdFrom) {
      case 'params.id':
        storeId = str(params.id) || null;
        break;
      case 'params.storeId':
        storeId = str(params.storeId) || null;
        break;
      case 'response.id':
        storeId = str(response.id) || null;
        break;
      case 'response.store.id':
        storeId = str(rec(response.store).id) || null;
        break;
      default:
        storeId = str(params.storeId) || str(body.storeId) || str(response.storeId) || str(rec(response.target).storeId) || null;
    }
  }

  const action = typeof route.action === 'function' ? route.action(ctx) : route.action;
  const entityId =
    str(params.id) || str(params.storeId) || str(params.productId) || str(params.customerId) || str(response.id) || null;

  let summary: string;
  try {
    summary = route.summary ? route.summary(ctx) : action;
  } catch {
    summary = action;
  }
  summary = summary.replace(/\s+/g, ' ').trim() || action;
  if (summary.length > SUMMARY_MAX_LENGTH) summary = `${summary.slice(0, SUMMARY_MAX_LENGTH - 1)}…`;

  let payload: Record<string, unknown> | null;
  try {
    payload = route.payload ? route.payload(ctx) : sanitizePayload({ params, body: ctx.body });
  } catch {
    payload = null;
  }

  return {
    module: route.module.slice(0, 40),
    action: action.slice(0, 80),
    entityType: route.entityType ?? null,
    entityId: entityId ? entityId.slice(0, 64) : null,
    summary,
    storeId,
    actorId: str(actor.id) || null,
    actorName: str(actor.name, str(actor.email)).slice(0, 150) || null,
    actorRole: str(actor.effectiveRole, str(actor.role)).slice(0, 40) || null,
    impersonatorId: str(actor.impersonatedBy?.id) || null,
    payload,
  };
}
