export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    ctx.waitUntil(env.AUDIT_QUEUE.send({ path: request.url }));
    await env.CACHE.put('last', request.url);
    const pending = env.CACHE.delete('stale');
    ctx.waitUntil(pending);
    void env.AUDIT_QUEUE.send({ explicit: true });
    return env.OUTBOX.send({ done: true }) as unknown as Response;
  },
} satisfies ExportedHandler<Env>;

export function noContext(env: Env) {
  env.AUDIT_QUEUE.send({ detached: true });
}

export class Counter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env.AUDIT_QUEUE.send({ boot: true });
  }
  async inc() {
    this.env.STATS.put('n', '1');
  }
}
