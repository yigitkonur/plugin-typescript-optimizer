import { DurableObject } from "cloudflare:workers";

export class Counter extends DurableObject<Env> {
  async fetch(_request: Request): Promise<Response> {
    const current = (await this.ctx.storage.get<number>("count")) ?? 0;
    const next = current + 1;
    await this.ctx.storage.put("count", next);
    return new Response(String(next));
  }
}
