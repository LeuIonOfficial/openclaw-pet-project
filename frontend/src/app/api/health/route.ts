import { healthcheck } from "@/lib/openclaw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await healthcheck());
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Health check failed.",
      },
      { status: 500 },
    );
  }
}
