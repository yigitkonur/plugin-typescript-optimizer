export const FLAGS = {
  ENABLE_EXPERIMENTAL_DISCOUNT_ENGINE_V2: false,
  ENABLE_NEW_CHECKOUT: true,
};
export const USE_LEGACY_PRICING = false;
export function price(cart: Cart) {
  if (FLAGS.ENABLE_EXPERIMENTAL_DISCOUNT_ENGINE_V2) {
    return calculateExperimentalDiscount(cart);
  }
  if (false) {
    return legacy(cart);
  }
  return cart.total;
}
