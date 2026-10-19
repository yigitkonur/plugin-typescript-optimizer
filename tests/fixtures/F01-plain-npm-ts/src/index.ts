import { usedHelper } from "./barrel/index.ts";
import { readSwallow, readRethrow, readWithContext, readOrDefault } from "./errors.ts";
import { isAdult, isReady, pick } from "./flags.ts";
import { cn as formCn } from "./forms/cn.ts";
import { cn as layoutCn } from "./layout/cn.ts";
import { cn as uiCn } from "./ui/cn.ts";
import { coerceSettings, deepName, loadSettings, note } from "./laundering.ts";
import { describeUser } from "./testonly.ts";
import { clampIndex, sum } from "./util/index.ts";
import { lengthOf } from "./wrapper.ts";

export function main(): string {
  const user = { id: 1, name: "Ada" };
  const classes = [uiCn("a", false), formCn("b"), layoutCn("c")].join("|");
  const files = [readSwallow, readRethrow, readWithContext, readOrDefault].length;
  return [
    usedHelper(2),
    files,
    isAdult(20),
    isReady(true),
    pick("x", "y"),
    lengthOf("  Foo "),
    classes,
    loadSettings('{"name":"s"}').name,
    coerceSettings({ name: "t" }).name,
    deepName('{"profile":{"owner":{"name":"n"}}}'),
    note,
    describeUser(user),
    clampIndex(5, 3),
    sum([1, 2]),
  ].join(",");
}
