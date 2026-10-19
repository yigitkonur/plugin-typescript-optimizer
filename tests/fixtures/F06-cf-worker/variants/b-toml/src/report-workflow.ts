import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export interface ReportParams {
  path: string;
}

export class ReportWorkflow extends WorkflowEntrypoint<Env, ReportParams> {
  async run(event: WorkflowEvent<ReportParams>, step: WorkflowStep): Promise<string> {
    const summary = await step.do("summarise", async () => `visited ${event.payload.path}`);
    await step.do("store", async () => {
      await this.env.CACHE.put(`report:${event.payload.path}`, summary);
    });
    return summary;
  }
}
