import { formatName, joinAll } from "utils/format";

const names = new Set(["Ada", "Lovelace"]);
console.log(formatName("Ada", "Lovelace"));
console.log(joinAll(names));
