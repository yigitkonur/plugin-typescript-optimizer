import { parseLine } from "./parse.js";
import { total } from "./sum.js";

const lines = ["a=1", "b=2", "c=3"];
const values = lines.map(parseLine).map((p) => p.value);
console.log(total(values));
