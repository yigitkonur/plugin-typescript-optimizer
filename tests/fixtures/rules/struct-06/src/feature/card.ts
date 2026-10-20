import { formatTag } from "../utils/formatTag";
import { pad } from "../utils/pad";
import { bigReport } from "../utils/big";
import { localThing } from "./localThing";
import { onlyCard, usedTwice } from "../shared/mixed";
import { viaBarrel } from "../helpers";

export const card = [formatTag("A"), pad(1), bigReport([1]).length, localThing(" x "), onlyCard("a"), usedTwice("B"), viaBarrel("c")];
