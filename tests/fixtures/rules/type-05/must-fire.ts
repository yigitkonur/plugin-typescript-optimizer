interface Customer { profile: { billing: { tier: string } } }
export function tier(customer: Customer): string {
  if (customer && customer.profile) {
    return customer.profile.billing.tier;
  }
  const t = customer?.profile?.billing?.tier;
  const x = t ?? null;
  return String(x);
}
export const label = (order: { shipping: { postal: string } }) =>
  order?.shipping?.postal?.toUpperCase?.();
