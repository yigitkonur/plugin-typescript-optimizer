import { listSlugs } from "@/lib/posts";

export async function GET() {
  return Response.json({ slugs: listSlugs() });
}

export async function POST(request: Request) {
  const body: unknown = await request.json();
  return Response.json({ received: body }, { status: 201 });
}
