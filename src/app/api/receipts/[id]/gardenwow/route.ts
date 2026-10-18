import { NextRequest, NextResponse } from "next/server";
import { authorizeGardenWowRequest } from "@/lib/gardenwow/server";
import {
  GardenWowSetupError,
  getGardenWowState,
  removeReceiptFromGardenWow,
  setGardenWowTarget,
  syncReceiptToGardenWow,
  type SyncOutcome,
} from "@/lib/gardenwow/sync";
import type { GardenWowSendInput } from "@/lib/gardenwow/types";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

// Where this receipt is meant to go and what GardenWow has for it.
export async function GET(request: NextRequest, context: Context) {
  const auth = await authorizeGardenWowRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  try {
    const state = await getGardenWowState(auth.supabase, id, auth.userId);
    if (!state) {
      return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
    }
    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof GardenWowSetupError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}

// Sets the destination (clientId null = Unassigned) and sends the receipt now,
// replacing any copy already in GardenWow. Also used to retry a failed send.
export async function POST(request: NextRequest, context: Context) {
  const auth = await authorizeGardenWowRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const input = (await request.json().catch(() => null)) as Partial<GardenWowSendInput> | null;
  if (input?.clientId !== undefined && input.clientId !== null && !normalizeId(input.clientId)) {
    return NextResponse.json({ error: "That GardenWow client isn't valid." }, { status: 400 });
  }

  const { id } = await context.params;
  const { supabase, userId } = auth;

  if (input && "clientId" in input) {
    const clientId = normalizeId(input.clientId);
    const visitId = clientId ? normalizeId(input.visitId) : null;
    const { error } = await setGardenWowTarget(supabase, id, userId, {
      clientId,
      clientName: clientId ? normalizeLabel(input.clientName) : null,
      visitId,
      visitLabel: visitId ? normalizeLabel(input.visitLabel) : null,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const outcome = await syncReceiptToGardenWow(supabase, id, userId, { restore: true });
  const state = await getGardenWowState(supabase, id, userId).catch(() => null);
  return respond(outcome, state);
}

// Removes the receipt from GardenWow; it won't be sent again automatically.
export async function DELETE(request: NextRequest, context: Context) {
  const auth = await authorizeGardenWowRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const result = await removeReceiptFromGardenWow(auth.supabase, id, auth.userId);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  const state = await getGardenWowState(auth.supabase, id, auth.userId).catch(() => null);
  return NextResponse.json({ ok: true, ...state });
}

function respond(outcome: SyncOutcome, state: Awaited<ReturnType<typeof getGardenWowState>>) {
  switch (outcome.state) {
    case "not_found":
      return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
    case "failed":
      return NextResponse.json({ error: outcome.message, ...state }, { status: outcome.status });
    case "waiting":
      return NextResponse.json(
        {
          error: `Add the ${outcome.missing.join(" and ")} and save first. It will be sent automatically.`,
          ...state,
        },
        { status: 400 },
      );
    default:
      return NextResponse.json({ outcome: outcome.state, ...state });
  }
}

function normalizeId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : null;
}

function normalizeLabel(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim().slice(0, 300) || null;
}
