import { NextRequest, NextResponse } from "next/server";
import { detectReceiptRegionsFromImage } from "@/lib/receipt-detection";
import {
  getAuthenticatedUserFromAccessToken,
  supabaseServerEnvError,
} from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
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

  const formData = await request.formData();
  const imageFile = formData.get("image");
  if (!(imageFile instanceof File)) {
    return NextResponse.json({ error: "Image upload is required." }, { status: 400 });
  }

  const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
  const detection = await detectReceiptRegionsFromImage({
    contentType: imageFile.type || "image/jpeg",
    imageBuffer,
  });

  return NextResponse.json(detection);
}
