// @ts-check
const { Color, pickColor } = require("./color");
const Registry = require("./registry");
const { describe } = require("./describe");

const r = new Registry("main");
r.add("a", 1);
console.log(describe(r), Color.RED, pickColor({ color: "blue" }));
