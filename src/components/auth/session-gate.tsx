"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen } from "@/components/auth/login-screen";
import {
  getSessionBootstrapState,
  initializeSession,
  subscribeToSessionBootstrap,
} from "@/lib/supabase/session";

type SessionGateProps = {
  children?: React.ReactNode;
  redirectTo?: string | null;
  requireAuth?: boolean;
};

export function SessionGate({
  children,
  redirectTo = null,
  requireAuth = false,
}: SessionGateProps) {
  const router = useRouter();
  const [sessionState, setSessionState] = useState(getSessionBootstrapState());

  useEffect(() => {
    const unsubscribe = subscribeToSessionBootstrap((state) => {
      setSessionState(state);
    });

    void initializeSession();

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (sessionState.status === "ready" && redirectTo) {
      router.replace(redirectTo);
      return;
    }

    if (requireAuth && sessionState.status === "signed_out") {
      router.replace("/");
    }
  }, [redirectTo, requireAuth, router, sessionState.status]);

  if (sessionState.status === "idle" || sessionState.status === "loading") {
    return (
      <main className="app-shell flex items-center justify-center">
        <div className="soft-card rounded-[28px] px-5 py-4 text-sm text-[var(--text-secondary)]">
          Restoring session...
        </div>
      </main>
    );
  }

  if (requireAuth) {
    if (sessionState.status === "ready") {
      return <>{children}</>;
    }

    return null;
  }

  if (sessionState.status === "ready") {
    return null;
  }

  return <LoginScreen />;
}
