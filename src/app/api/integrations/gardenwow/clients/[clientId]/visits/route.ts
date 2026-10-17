import { NextRequest, NextResponse } from "next/server";
import {
  authorizeGardenWowRequest,
  gardenWowErrorResponse,
  listGardenWowVisits,
} from "@/lib/gardenwow/server";

type Context = {
  params: Promise<{
    clientId: string;
  }>;
};

export async function GET(request: NextRequest, context: Context) {
  const auth = await authorizeGardenWowRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { clientId } = await context.params;
  const aroundParam = request.nextUrl.searchParams.get("around");
  const around = aroundParam && /^\d{4}-\d{2}-\d{2}$/.test(aroundParam) ? aroundParam : null;

  try {
    const result = await listGardenWowVisits(clientId, around);
    if (!result.ok) {
      return gardenWowErrorResponse(result.result);
    }

    return NextResponse.json({ visits: result.visits });
  } catch (error) {
    return gardenWowErrorResponse(error as Error);
  }
}
