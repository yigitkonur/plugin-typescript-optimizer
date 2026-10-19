export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    env.AUDIT_QUEUE.send({ path: request.url, timestamp: Date.now() });
    env.CACHE.put('last', request.url);
    env.CACHE.delete('stale').catch(() => {});
    env.DB.prepare('INSERT INTO hits VALUES (?)').bind(request.url).run();
    return new Response('Accepted', { status: 202 });
  },
  async scheduled(controller, env, ctx) {
    env.AUDIT_QUEUE.send({ cron: controller.cron });
  },
} satisfies ExportedHandler<Env>;
