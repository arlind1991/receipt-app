import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUserFromAccessToken,
  getSupabaseAdminClient,
  supabaseServerEnvError,
} from "@/lib/supabase/server";

const devHelpersEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_RECEIPT_DEBUG === "true";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (!devHelpersEnabled) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

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

  const { id } = await context.params;
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: supabaseServerEnvError }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("receipts")
    .select(
      "id, status, image_path, merchant_name, receipt_date, total_amount, vat_amount, currency, category, raw_ocr_text, parsed_ocr_json, extraction_error",
    )
    .eq("id", id)
    .eq("user_id", authResult.data.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  }

  return NextResponse.json({
    debug: data,
  });
}
