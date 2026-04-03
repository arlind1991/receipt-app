import type {
  AuthChangeEvent,
  Provider,
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

function getAuthRedirectUrl(path = "/auth/callback") {
  if (typeof window === "undefined") {
    return undefined;
  }

  return `${window.location.origin}${path}`;
}

export async function signInWithPassword(email: string, password: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: supabaseEnvError ?? "Supabase environment variables are missing.",
    };
  }

  bindAuthStateListener(supabase);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
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
    status: data.user ? "ready" : "signed_out",
    user: data.user ?? null,
  });

  return { ok: true as const };
}

export async function signUpWithPassword(email: string, password: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: supabaseEnvError ?? "Supabase environment variables are missing.",
    };
  }

  bindAuthStateListener(supabase);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
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
    status: data.session?.user ? "ready" : "signed_out",
    user: data.session?.user ?? data.user ?? null,
  });

  return {
    ok: true as const,
    needsEmailConfirmation: !data.session,
  };
}

export async function sendMagicLink(email: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: supabaseEnvError ?? "Supabase environment variables are missing.",
    };
  }

  bindAuthStateListener(supabase);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
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

export async function sendPasswordReset(email: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: supabaseEnvError ?? "Supabase environment variables are missing.",
    };
  }

  bindAuthStateListener(supabase);

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRedirectUrl(),
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}

export async function signInWithProvider(provider: Provider) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: supabaseEnvError ?? "Supabase environment variables are missing.",
    };
  }

  bindAuthStateListener(supabase);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getAuthRedirectUrl(),
    },
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const, url: data.url };
}

export async function updateCurrentUserPassword(password: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: supabaseEnvError ?? "Supabase environment variables are missing.",
    };
  }

  const { data, error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  if (data.user) {
    updateSessionBootstrapState({
      error: null,
      status: "ready",
      user: data.user,
    });
  }

  return { ok: true as const };
}

export async function completeAuthSessionFromUrl() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: supabaseEnvError ?? "Supabase environment variables are missing.",
      type: null,
      user: null,
    };
  }

  bindAuthStateListener(supabase);

  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const code = url.searchParams.get("code");
  const type = url.searchParams.get("type") ?? hashParams.get("type");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      updateSessionBootstrapState({
        error: error.message,
        status: "error",
        user: null,
      });
      return {
        ok: false as const,
        error: error.message,
        type,
        user: null,
      };
    }
  }

  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      updateSessionBootstrapState({
        error: error.message,
        status: "error",
        user: null,
      });
      return {
        ok: false as const,
        error: error.message,
        type,
        user: null,
      };
    }
  }

  const user = await initializeSession({ force: true });
  return {
    ok: true as const,
    type,
    user,
  };
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
