// if (a && b) { for (;;) { while (c) { switch (d) { case 1: } } } }
export function label(kind: string): string {
  const note = 'if (a && b) ? for while case catch';
  /* else if (x || y) { z ?? w } */
  const tpl = `${kind}`;
  return note + tpl + kind;
}
