"use client";

import { useMemo, useState } from "react";
import { StatusBanner } from "@/components/status-banner";
import {
  sendMagicLink,
  sendPasswordReset,
  signInWithPassword,
  signInWithProvider,
  signUpWithPassword,
  supabaseEnvError,
} from "@/lib/supabase/session";

type AuthMode = "sign_in" | "sign_up" | "forgot_password";

export function LoginScreen() {
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "error">("info");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);

  const headline = useMemo(() => {
    if (mode === "sign_up") {
      return "Create your account";
    }

    if (mode === "forgot_password") {
      return "Reset your password";
    }

    return "Sign in";
  }, [mode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (supabaseEnvError) {
      setStatusTone("error");
      setStatusMessage(supabaseEnvError);
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    if (mode === "forgot_password") {
      const result = await sendPasswordReset(email.trim());
      if (!result.ok) {
        setStatusTone("error");
        setStatusMessage(result.error);
        setIsSubmitting(false);
        return;
      }

      setStatusTone("info");
      setStatusMessage("Password reset email sent. Open the link to choose a new password.");
      setIsSubmitting(false);
      return;
    }

    if (mode === "sign_up") {
      const result = await signUpWithPassword(email.trim(), password);
      if (!result.ok) {
        setStatusTone("error");
        setStatusMessage(result.error);
        setIsSubmitting(false);
        return;
      }

      setStatusTone("info");
      setStatusMessage(
        result.needsEmailConfirmation
          ? "Check your email to confirm your account, then come back and sign in."
          : "Account created. You’re signed in and ready to scan.",
      );
      setIsSubmitting(false);
      return;
    }

    const result = await signInWithPassword(email.trim(), password);
    if (!result.ok) {
      setStatusTone("error");
      setStatusMessage(result.error);
      setIsSubmitting(false);
      return;
    }

    setStatusTone("info");
    setStatusMessage("Signing you in...");
    setIsSubmitting(false);
  }

  async function handleMagicLink() {
    if (supabaseEnvError) {
      setStatusTone("error");
      setStatusMessage(supabaseEnvError);
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    const result = await sendMagicLink(email.trim());
    if (!result.ok) {
      setStatusTone("error");
      setStatusMessage(result.error);
      setIsSubmitting(false);
      return;
    }

    setStatusTone("info");
    setStatusMessage("Magic link sent. Open it on this device to finish signing in.");
    setIsSubmitting(false);
  }

  async function handleSocialSignIn(provider: "google" | "apple") {
    if (supabaseEnvError) {
      setStatusTone("error");
      setStatusMessage(supabaseEnvError);
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    const result = await signInWithProvider(provider);
    if (!result.ok) {
      setStatusTone("error");
      setStatusMessage(result.error);
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell flex min-h-[100dvh] items-center justify-center px-4 py-6">
      <section className="glass-panel mx-auto w-full max-w-md rounded-[32px] p-6">
        <p className="eyebrow">SnapReceipt</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{headline}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
          Keep receipts synced to your account so they stay with you across devices.
        </p>

        <div className="mt-6 grid gap-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleSocialSignIn("google")}
            className="w-full rounded-full border border-white/12 bg-white/6 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue with Google
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleSocialSignIn("apple")}
            className="w-full rounded-full border border-white/12 bg-white/6 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue with Apple
          </button>
        </div>

        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">
          <span className="h-px flex-1 bg-white/10" />
          <span>Email</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
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

          {mode !== "forgot_password" ? (
            <label className="block">
              <span className="mb-2 block text-sm text-[var(--text-secondary)]">Password</span>
              <input
                type="password"
                required
                autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                className="w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
              />
            </label>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#082319] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? mode === "forgot_password"
                ? "Sending reset..."
                : mode === "sign_up"
                  ? "Creating account..."
                  : "Signing in..."
              : mode === "forgot_password"
                ? "Send reset link"
                : mode === "sign_up"
                  ? "Create account"
                  : "Sign in"}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-3 text-sm text-[var(--text-secondary)]">
          {mode !== "sign_in" ? (
            <button
              type="button"
              onClick={() => setMode("sign_in")}
              className="transition hover:text-white"
            >
              Sign in instead
            </button>
          ) : null}

          {mode !== "sign_up" ? (
            <button
              type="button"
              onClick={() => setMode("sign_up")}
              className="transition hover:text-white"
            >
              Create account
            </button>
          ) : null}

          {mode !== "forgot_password" ? (
            <button
              type="button"
              onClick={() => setMode("forgot_password")}
              className="transition hover:text-white"
            >
              Forgot password
            </button>
          ) : null}
        </div>

        <div className="mt-6 rounded-[24px] border border-white/10 bg-white/5 p-4">
          <button
            type="button"
            onClick={() => setShowMagicLink((current) => !current)}
            className="text-sm font-medium text-white transition hover:text-[var(--accent)]"
          >
            {showMagicLink ? "Hide magic link option" : "Use magic link instead"}
          </button>

          {showMagicLink ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm leading-6 text-[var(--text-secondary)]">
                Magic link is available as a fallback if you do not want to use a password.
              </p>
              <button
                type="button"
                disabled={isSubmitting || !email.trim()}
                onClick={() => void handleMagicLink()}
                className="w-full rounded-full border border-white/12 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send magic link
              </button>
            </div>
          ) : null}
        </div>

        {statusMessage ? (
          <div className="mt-4">
            <StatusBanner tone={statusTone} message={statusMessage} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
