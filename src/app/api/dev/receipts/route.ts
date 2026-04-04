import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUserFromAccessToken,
  getSupabaseAdminClient,
  supabaseServerEnvError,
} from "@/lib/supabase/server";

const devHelpersEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_HELPERS === "true";

export async function DELETE(request: NextRequest) {
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

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: supabaseServerEnvError }, { status: 500 });
  }

  const { data: receipts, error: listError } = await supabase
    .from("receipts")
    .select("id, image_path, processed_ocr_image_path")
    .eq("user_id", authResult.data.id);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const imagePaths =
    receipts
      ?.flatMap((receipt) => [receipt.image_path, receipt.processed_ocr_image_path])
      .filter(Boolean) ?? [];

  if (imagePaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("receipts")
      .remove(imagePaths);

    if (storageError) {
      return NextResponse.json({ error: storageError.message }, { status: 500 });
    }
  }

  const { error: deleteError } = await supabase
    .from("receipts")
    .delete()
    .eq("user_id", authResult.data.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
