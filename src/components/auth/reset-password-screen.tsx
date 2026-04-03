"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import { updateCurrentUserPassword } from "@/lib/supabase/session";

export function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "error">("info");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      setStatusTone("error");
      setStatusMessage("Choose a password with at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setStatusTone("error");
      setStatusMessage("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    const result = await updateCurrentUserPassword(password);
    if (!result.ok) {
      setStatusTone("error");
      setStatusMessage(result.error);
      setIsSubmitting(false);
      return;
    }

    setStatusTone("info");
    setStatusMessage("Password updated. Taking you back to the camera.");
    setIsSubmitting(false);
    router.replace("/camera");
    router.refresh();
  }

  return (
    <main className="app-shell flex min-h-[100dvh] items-center justify-center px-4 py-6">
      <section className="glass-panel mx-auto w-full max-w-md rounded-[32px] p-6">
        <p className="eyebrow">Password Reset</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
          Set a new password for this account so you can sign in normally next time.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm text-[var(--text-secondary)]">
              New password
            </span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm outline-none focus:border-[var(--border-strong)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-[var(--text-secondary)]">
              Confirm password
            </span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm outline-none focus:border-[var(--border-strong)]"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#082319] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Updating password..." : "Update password"}
          </button>
        </form>

        {statusMessage ? (
          <div className="mt-4">
            <StatusBanner tone={statusTone} message={statusMessage} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
