/**
 * Where this process is running.
 *
 * - 'cloud': the multi-tenant API at api.tapntrade.store. Every store's data,
 *   the super-admin, impersonation and subscriptions.
 * - 'store': the store server on a shop's cashier PC. One store's data in a
 *   local Postgres, reached by the shop's devices over the Wi-Fi, so service
 *   carries on when the internet drops. It syncs with the cloud when it can.
 *
 * Unset means 'cloud', so the existing EC2 deploy keeps working without a new
 * env var. Anything else unrecognised is a typo that would silently run a
 * shop PC with cloud behaviour, so it stops the boot instead.
 */
export type DeploymentMode = 'cloud' | 'store';

export function deploymentMode(env: NodeJS.ProcessEnv = process.env): DeploymentMode {
  const raw = (env.DEPLOYMENT_MODE ?? '').trim();
  if (raw === '' || raw === 'cloud') return 'cloud';
  if (raw === 'store') return 'store';
  throw new Error(`DEPLOYMENT_MODE must be "cloud" or "store", got "${raw}"`);
}

export const isStoreServer = (env: NodeJS.ProcessEnv = process.env) =>
  deploymentMode(env) === 'store';
