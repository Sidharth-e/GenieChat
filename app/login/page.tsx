"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowRight,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { AI_NAME } from "@/constants/main";
import { useAuthStore } from "@/lib/auth";

const featureList = [
  {
    title: "Persistent conversation memory",
    description:
      "Threads, context, and workspace state stay connected across sessions.",
    icon: Sparkles,
  },
  {
    title: "Agentic + multi-agent workflows",
    description:
      "Run autonomous tasks and coordinate multiple agents to execute complex work faster.",
    icon: ShieldCheck,
  },
  {
    title: "Unified workstream",
    description:
      "Move between inbox, meetings, notes, and chat without breaking flow.",
    icon: Workflow,
  },
];

function safeDecodeCallbackUrl(callbackUrlParam: string | null): string {
  if (!callbackUrlParam) return "/chat/new";
  try {
    const decoded = decodeURIComponent(callbackUrlParam);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) {
      return decoded;
    }
    return "/chat/new";
  } catch {
    return "/chat/new";
  }
}

function getLoginErrorMessage(error: string): string {
  switch (error) {
    case "AccessDenied":
      return "Your GitHub account is not permitted to sign in. Contact your administrator.";
    case "OAuthAccountNotLinked":
      return "That email is already linked to another sign-in method.";
    case "CredentialsSignin":
      return "Invalid credentials. Please try again.";
    default:
      return "An error occurred during sign in.";
  }
}

function LoginForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const callbackUrlParam = searchParams.get("callbackUrl");
  const callbackUrl = safeDecodeCallbackUrl(callbackUrlParam);
  const [isLoading, setIsLoading] = useState(false);

  const handleGitHubSignIn = async () => {
    setIsLoading(true);
    try {
      await useAuthStore.getState().signInWithGitHub(callbackUrl);
    } catch {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative h-dvh overflow-hidden bg-background text-foreground">
      <div className="relative mx-auto flex h-full w-full flex-col px-4 py-4 sm:px-6 sm:py-5">
        <main className="flex flex-1 items-center py-4 sm:py-6">
          <div className="grid w-full gap-0 overflow-hidden rounded-3xl border border-card-border bg-card-bg/85 backdrop-blur-xl shadow-[0_32px_80px_-45px_rgba(0,0,0,0.75)] lg:grid-cols-[1.05fr_0.95fr]">
            <section className="border-b border-card-border bg-surface-muted/65 p-5 sm:p-6 lg:border-r lg:border-b-0 lg:p-8">
              <div className="animate-slide-up">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary/85">
                  Welcome back
                </p>
                <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-[2rem]">
                  Sign in once.
                  <br />
                  Pick up work instantly.
                </h1>
                <p className="mt-4 max-w-lg text-sm leading-relaxed text-text-secondary sm:text-base">
                  Access your full workspace with GitHub authentication,
                  including active chats, notes, meetings, and tools.
                </p>
              </div>

              <div className="mt-6 space-y-2.5">
                {featureList.map((item) => (
                  <div
                    key={item.title}
                    className="flex items-start gap-3 rounded-2xl border border-tertiary/10 bg-background/80 p-3.5 transition-colors hover:bg-background"
                  >
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <item.icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {item.title}
                      </p>
                      <p className="mt-1 text-sm text-text-secondary">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex items-center p-5 sm:p-6 lg:p-8">
              <div className="w-full animate-scale-in rounded-2xl border border-tertiary/10 bg-background/80 p-5 sm:p-6">
                <span className="inline-flex items-center gap-2 rounded-full border border-tertiary/10 bg-surface-muted px-3 py-1 text-xs font-medium text-tertiary/80">
                  <LockKeyhole className="h-3.5 w-3.5 text-primary" />
                  Secure sign-in
                </span>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
                  Continue with GitHub
                </h2>
                <p className="mt-2 text-sm text-text-secondary">
                  Use your GitHub account to continue to {AI_NAME}.
                </p>

                {error && (
                  <div className="mt-5 rounded-xl border border-[var(--red-border)] bg-[var(--red-bg)] px-4 py-3">
                    <p className="text-sm text-[var(--red)]">
                      {getLoginErrorMessage(error)}
                    </p>
                  </div>
                )}

                <button
                  onClick={handleGitHubSignIn}
                  disabled={isLoading}
                  className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <span className="flex items-center justify-center gap-2.5">
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
                    </svg>
                    {isLoading ? "Signing in..." : "Continue with GitHub"}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </button>

                <p className="mt-4 text-center text-xs text-text-secondary">
                  Access follows your organization policy and security controls.
                </p>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="animate-pulse text-text-secondary">Loading...</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
