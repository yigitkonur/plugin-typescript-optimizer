// @ts-check
/** @enum {string} */
const Color = { RED: 'red' };

/**
 * @constructor
 * @param {?string} name
 */
function Person(name) { this.name = name; }
Person.prototype.greet = function () { return 'hi ' + this.name; };

/** @param {function(string): number} cb */
/** @type {*} */
/** @return {!Object} */
/** @param {string=} opt */
/** @param {...number} rest */
/** @type {Array.<string>} */

import fs from 'node:fs';
module.exports = { Person, Color, fs };
