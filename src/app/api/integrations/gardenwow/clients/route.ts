import { NextRequest, NextResponse } from "next/server";
import {
  authorizeGardenWowRequest,
  gardenWowErrorResponse,
  searchGardenWowClients,
} from "@/lib/gardenwow/server";

export async function GET(request: NextRequest) {
  const auth = await authorizeGardenWowRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const query = request.nextUrl.searchParams.get("q")?.trim().slice(0, 200) ?? "";

  try {
    const result = await searchGardenWowClients(query);
    if (!result.ok) {
      return gardenWowErrorResponse(result.result);
    }

    return NextResponse.json({ clients: result.clients });
  } catch (error) {
    return gardenWowErrorResponse(error as Error);
  }
}
