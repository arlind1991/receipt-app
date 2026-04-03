"use client";

import { useState } from "react";
import { StatusBanner } from "@/components/status-banner";
import { signInWithEmail, supabaseEnvError } from "@/lib/supabase/session";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (supabaseEnvError) {
      setStatusMessage(supabaseEnvError);
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    const result = await signInWithEmail(email.trim());
    if (!result.ok) {
      setStatusMessage(result.error);
      setIsSubmitting(false);
      return;
    }

    setSent(true);
    setIsSubmitting(false);
  }

  return (
    <main className="app-shell flex items-center justify-center">
      <section className="glass-panel mx-auto w-full max-w-md rounded-[32px] p-6">
        <p className="eyebrow">SnapReceipt</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in with email</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
          Use a magic link so receipts stay attached to your account and follow you across devices.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm text-[var(--text-secondary)]">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#082319] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Sending..." : "Send magic link"}
          </button>
        </form>

        {sent ? (
          <div className="mt-4">
            <StatusBanner
              message="Check your email for the sign-in link. After you open it, you’ll land back in the app."
            />
          </div>
        ) : null}

        {statusMessage ? (
          <div className="mt-4">
            <StatusBanner tone="error" message={statusMessage} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
