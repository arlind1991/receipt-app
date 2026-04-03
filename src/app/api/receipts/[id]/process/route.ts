import { NextRequest, NextResponse } from "next/server";
import { extractReceiptFieldsFromImage } from "@/lib/receipt-ocr";
import {
  getAuthenticatedUserFromAccessToken,
  getSupabaseAdminClient,
  supabaseServerEnvError,
} from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
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

  const { data: receipt, error: receiptError } = await supabase
    .from("receipts")
    .select("id, user_id, image_path, status")
    .eq("id", id)
    .eq("user_id", authResult.data.id)
    .single<{ id: string; user_id: string; image_path: string; status: string }>();

  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  }

  if (receipt.status === "done") {
    return NextResponse.json({ ok: true, status: "done" });
  }

  const { data: image, error: downloadError } = await supabase.storage
    .from("receipts")
    .download(receipt.image_path);

  if (downloadError || !image) {
    await markReceiptFailed(supabase, receipt.id);
    return NextResponse.json(
      { error: downloadError?.message ?? "Receipt image could not be loaded." },
      { status: 500 },
    );
  }

  const arrayBuffer = await image.arrayBuffer();
  const extractionResult = await extractReceiptFieldsFromImage({
    contentType: image.type || "image/jpeg",
    imageBuffer: Buffer.from(arrayBuffer),
  });

  if (!extractionResult.ok) {
    await markReceiptFailed(supabase, receipt.id);
    return NextResponse.json({ error: extractionResult.error }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("receipts")
    .update({
      ...extractionResult.data,
      status: "done",
    })
    .eq("id", receipt.id)
    .eq("user_id", authResult.data.id);

  if (updateError) {
    await markReceiptFailed(supabase, receipt.id);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "done" });
}

async function markReceiptFailed(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  receiptId: string,
) {
  await supabase.from("receipts").update({ status: "failed" }).eq("id", receiptId);
}
