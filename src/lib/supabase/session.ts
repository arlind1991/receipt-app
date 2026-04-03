import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  supabaseEnvError,
} from "@/lib/supabase/client";
import { clearAppLocalState } from "@/lib/local-storage";

export { supabaseEnvError };

type SessionBootstrapState = {
  error: string | null;
  status: "idle" | "loading" | "ready" | "signed_out" | "error";
  user: User | null;
};

let sessionBootstrapState: SessionBootstrapState = {
  error: null,
  status: "idle",
  user: null,
};
let pendingSessionRequest: Promise<User | null> | null = null;
let authSubscriptionInitialized = false;
const listeners = new Set<(state: SessionBootstrapState) => void>();

export function getSessionBootstrapState() {
  return sessionBootstrapState;
}

export function subscribeToSessionBootstrap(
  listener: (state: SessionBootstrapState) => void,
) {
  listeners.add(listener);
  listener(sessionBootstrapState);

  return () => {
    listeners.delete(listener);
  };
}

function updateSessionBootstrapState(nextState: SessionBootstrapState) {
  sessionBootstrapState = nextState;
  listeners.forEach((listener) => listener(sessionBootstrapState));
}

function bindAuthStateListener(supabase: SupabaseClient) {
  if (authSubscriptionInitialized) {
    return;
  }

  authSubscriptionInitialized = true;

  supabase.auth.onAuthStateChange((event, session) => {
    syncStateFromSession(event, session);
  });
}

function syncStateFromSession(_event: AuthChangeEvent, session: Session | null) {
  if (session?.user) {
    updateSessionBootstrapState({
      error: null,
      status: "ready",
      user: session.user,
    });
    return;
  }

  updateSessionBootstrapState({
    error: null,
    status: "signed_out",
    user: null,
  });
}

export async function initializeSession(options?: { force?: boolean }) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    updateSessionBootstrapState({
      error: supabaseEnvError,
      status: "error",
      user: null,
    });
    return null;
  }

  bindAuthStateListener(supabase);

  if (pendingSessionRequest && !options?.force) {
    return pendingSessionRequest;
  }

  updateSessionBootstrapState({
    error: null,
    status: "loading",
    user: sessionBootstrapState.user,
  });

  pendingSessionRequest = (async () => {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      updateSessionBootstrapState({
        error: error.message,
        status: "error",
        user: null,
      });
      return null;
    }

    if (session?.user) {
      updateSessionBootstrapState({
        error: null,
        status: "ready",
        user: session.user,
      });
      return session.user;
    }

    updateSessionBootstrapState({
      error: null,
      status: "signed_out",
      user: null,
    });
    return null;
  })();

  const user = await pendingSessionRequest;
  pendingSessionRequest = null;
  return user;
}

export async function ensureBrowserSession() {
  if (sessionBootstrapState.user) {
    return sessionBootstrapState.user;
  }

  return initializeSession();
}

export async function signInWithEmail(email: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: supabaseEnvError ?? "Supabase environment variables are missing.",
    };
  }

  bindAuthStateListener(supabase);

  const emailRedirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback`
      : undefined;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
    },
  });

  if (error) {
    updateSessionBootstrapState({
      error: error.message,
      status: "error",
      user: null,
    });
    return { ok: false as const, error: error.message };
  }

  updateSessionBootstrapState({
    error: null,
    status: "signed_out",
    user: null,
  });

  return { ok: true as const };
}

export async function signOutCurrentUser() {
  const supabase = getSupabaseBrowserClient();
  clearAppLocalState();
  pendingSessionRequest = null;

  if (!supabase) {
    updateSessionBootstrapState({
      error: null,
      status: "signed_out",
      user: null,
    });
    return;
  }

  await supabase.auth.signOut();
  updateSessionBootstrapState({
    error: null,
    status: "signed_out",
    user: null,
  });
}
