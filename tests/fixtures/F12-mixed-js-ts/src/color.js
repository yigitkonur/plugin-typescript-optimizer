// @ts-check

/**
 * @enum {string}
 */
const Color = {
  RED: "red",
  GREEN: "green",
  BLUE: "blue",
};

/**
 * @param {!Object} options Closure non-nullable object
 * @return {?string} Closure nullable string
 */
function pickColor(options) {
  const c = /** @type {{color?: string}} */ (options).color;
  return c === undefined ? null : c;
}

module.exports = { Color, pickColor };
