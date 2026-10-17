"use client";

import { useState } from "react";
import { StatusBanner } from "@/components/status-banner";
import {
  sendEmailOtp,
  supabaseEnvError,
  verifyEmailOtp,
} from "@/lib/supabase/session";

// Email OTP only: enter email → receive a 6-digit code → enter it → signed in.
// The previous password / Google / Apple / magic-link UI lives in legacy-login-screen.tsx.
type Step = "email" | "code";

const CODE_LENGTH = 6;

export function LoginScreen() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "error">("info");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function showError(message: string) {
    setStatusTone("error");
    setStatusMessage(message);
  }

  async function requestCode() {
    if (supabaseEnvError) {
      showError(supabaseEnvError);
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    const result = await sendEmailOtp(email.trim());
    setIsSubmitting(false);

    if (!result.ok) {
      showError(result.error);
      return;
    }

    setCode("");
    setStep("code");
    setStatusTone("info");
    setStatusMessage(`We sent a ${CODE_LENGTH}-digit code to ${email.trim()}.`);
  }

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestCode();
  }

  async function handleCodeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (code.length !== CODE_LENGTH) {
      showError(`Enter the ${CODE_LENGTH}-digit code from the email.`);
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    const result = await verifyEmailOtp(email.trim(), code);
    if (!result.ok) {
      setIsSubmitting(false);
      showError(result.error);
      return;
    }

    setStatusTone("info");
    setStatusMessage("Signing you in...");
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setStatusMessage(null);
  }

  return (
    <main className="app-shell flex min-h-[100dvh] items-center justify-center px-4 py-6">
      <section className="glass-panel mx-auto w-full max-w-md rounded-[32px] p-6">
        <p className="eyebrow">SnapReceipt</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {step === "email" ? "Sign in" : "Enter your code"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
          {step === "email"
            ? "Enter your email and we’ll send you a sign-in code. No password needed."
            : "Check your inbox and enter the code to finish signing in."}
        </p>

        {step === "email" ? (
          <form onSubmit={(event) => void handleEmailSubmit(event)} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm text-[var(--text-secondary)]">Email</span>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="field-control w-full rounded-2xl px-4 py-3 text-sm outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={isSubmitting || !email.trim()}
              className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Sending code..." : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => void handleCodeSubmit(event)} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm text-[var(--text-secondary)]">
                {CODE_LENGTH}-digit code
              </span>
              <input
                type="text"
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern={`[0-9]{${CODE_LENGTH}}`}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))
                }
                placeholder="123456"
                className="field-control w-full rounded-2xl px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={isSubmitting || code.length !== CODE_LENGTH}
              className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Verifying..." : "Sign in"}
            </button>

            <div className="flex flex-wrap justify-between gap-3 text-sm text-[var(--text-secondary)]">
              <button
                type="button"
                onClick={changeEmail}
                disabled={isSubmitting}
                className="transition hover:text-[var(--text-primary)]"
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={() => void requestCode()}
                disabled={isSubmitting}
                className="transition hover:text-[var(--text-primary)]"
              >
                Resend code
              </button>
            </div>
          </form>
        )}

        {statusMessage ? (
          <div className="mt-4">
            <StatusBanner tone={statusTone} message={statusMessage} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
