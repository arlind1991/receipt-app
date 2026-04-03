"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { initializeSession, supabaseEnvError } from "@/lib/supabase/session";

export function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    async function completeAuth() {
      const supabase = getSupabaseBrowserClient();
      const code = searchParams.get("code");

      if (supabase && code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          router.replace("/");
          return;
        }
      }

      const user = await initializeSession({ force: true });
      if (user) {
        router.replace("/camera");
        return;
      }

      router.replace("/");
    }

    void completeAuth();
  }, [router, searchParams]);

  return (
    <main className="app-shell flex items-center justify-center">
      <section className="glass-panel mx-auto w-full max-w-md rounded-[32px] p-6">
        <p className="eyebrow">Signing In</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Finishing your sign-in</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
          Hold on for a moment while we restore your session.
        </p>
        {supabaseEnvError ? (
          <div className="mt-4">
            <StatusBanner tone="error" message={supabaseEnvError} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
