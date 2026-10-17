import { NextRequest, NextResponse } from "next/server";
import { isGardenWowEnabledForUser } from "@/lib/gardenwow/server";
import {
  getAuthenticatedUserFromAccessToken,
  supabaseServerEnvError,
} from "@/lib/supabase/server";

// Tells the app whether to show GardenWow features for the signed-in user.
export async function GET(request: NextRequest) {
  if (supabaseServerEnvError) {
    return NextResponse.json({ error: supabaseServerEnvError }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!accessToken) {
    return NextResponse.json({ error: "Missing session token." }, { status: 401 });
  }

  const authResult = await getAuthenticatedUserFromAccessToken(accessToken);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  return NextResponse.json({ enabled: isGardenWowEnabledForUser(authResult.data.id) });
}
