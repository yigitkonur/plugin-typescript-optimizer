// @ts-check

/**
 * @constructor
 * @param {string} name
 */
function Registry(name) {
  /** @type {string} */
  this.name = name;
  /** @type {Object<string, number>} */
  this.items = {};
}

/**
 * @param {string} key
 * @param {number} value
 * @return {Registry}
 */
Registry.prototype.add = function (key, value) {
  this.items[key] = value;
  return this;
};

/**
 * @param {string} key
 * @return {?number}
 */
Registry.prototype.get = function (key) {
  return key in this.items ? this.items[key] : null;
};

/**
 * @class
 */
class Counter {
  constructor() {
    this.n = 0;
  }
  inc() {
    this.n += 1;
    return this.n;
  }
}

module.exports = Registry;
module.exports.Counter = Counter;
exports.VERSION = 1;
