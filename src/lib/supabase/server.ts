import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseServerEnvError =
  !supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey
    ? "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY for server-side receipt processing."
    : null;

export function getSupabaseAdminClient() {
  if (supabaseServerEnvError) {
    return null;
  }

  return createClient(supabaseUrl!, supabaseServiceRoleKey!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function getAuthenticatedUserFromAccessToken(accessToken: string) {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return { ok: false as const, error: supabaseServerEnvError };
  }

  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data.user) {
    return {
      ok: false as const,
      error: "Your session is no longer valid. Please sign in again.",
    };
  }

  return {
    ok: true as const,
    data: data.user,
  };
}
