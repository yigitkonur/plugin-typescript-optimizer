import { Counter } from "./counter";
import { ReportWorkflow } from "./report-workflow";

export { Counter, ReportWorkflow };

async function logHit(path: string): Promise<void> {
  console.log(`hit ${path}`);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    ctx.waitUntil(logHit(url.pathname));

    if (url.pathname === "/debug") {
      return new Response(process.env.LOG_LEVEL ?? "info");
    }
    if (url.pathname === "/count") {
      const stub = env.COUNTER.get(env.COUNTER.idFromName("global"));
      return stub.fetch(request);
    }
    if (url.pathname === "/report") {
      const instance = await env.REPORT.create({ params: { path: url.pathname } });
      ctx.waitUntil(instance.status());
      return Response.json({ id: instance.id });
    }

    env.CACHE.put(`seen:${url.pathname}`, new Date().toISOString());
    return new Response("ok");
  },
} satisfies ExportedHandler<Env>;
