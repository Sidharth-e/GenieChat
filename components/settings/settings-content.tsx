"use client";

import * as React from "react";
import {
  Bot,
  Brain,
  CheckCircle2,
  LogOut,
  Monitor,
  Moon,
  Shield,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { useAuthStore } from "@/lib/auth";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import { useChatSettings } from "@/lib/stores";
import { ProviderKey } from "@/lib/types";

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  google: "Google",
  ollama: "Ollama",
};

const PROVIDER_BADGE_CLASSES: Record<ProviderKey, string> = {
  google: "bg-[var(--blue-bg)] text-[var(--blue)]",
  ollama: "bg-[var(--bg-subtle)] text-[var(--text-muted)]",
};

export function SettingsContent() {
  const { user, signOutUser } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const { selectedModel, setSelectedModel, memoryEnabled, setMemoryEnabled } =
    useChatSettings();

  const selectedModelConfig = React.useMemo(
    () =>
      AVAILABLE_MODELS.find((model) => model.id === selectedModel) ??
      AVAILABLE_MODELS[0],
    [selectedModel],
  );

  const handleThemeChange = (value: string) => {
    if (value === "light" || value === "dark" || value === "system") {
      setTheme(value);
    }
  };

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 mx-auto px-4 pt-16 pb-8 md:px-8 md:pt-24 md:pb-10 animate-in fade-in duration-300">
      <section className="rounded-2xl border border-card-border bg-card-bg p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary/80">
              Settings
            </p>
            <h1 className="mt-1 text-3xl font-serif text-foreground tracking-tight">
              Preferences
            </h1>
            <p className="mt-2 text-sm text-tertiary/70">
              Changes save automatically and apply across the app.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Auto-saved
          </span>
        </div>
      </section>

      <section className="rounded-2xl border border-card-border bg-card-bg p-6 shadow-sm">
        <div className="flex items-center gap-2 text-foreground">
          <UserRound className="h-4 w-4" />
          <h2 className="text-lg font-semibold">Account</h2>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-tertiary/10 bg-secondary/40 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-tertiary/60">
              Name
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {user?.name || "Unknown"}
            </p>
          </div>
          <div className="rounded-xl border border-tertiary/10 bg-secondary/40 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-tertiary/60">
              Email
            </p>
            <p className="mt-1 text-sm font-medium text-foreground break-all">
              {user?.email || "Unknown"}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-tertiary/10 px-3 py-1 text-xs font-medium text-tertiary">
            <Shield className="h-3.5 w-3.5" />
            {user?.role
              ? `${user.role.charAt(0).toUpperCase() + user.role.slice(1)} access`
              : "Standard access"}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => void signOutUser()}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-card-border bg-card-bg p-6 shadow-sm">
        <div className="flex items-center gap-2 text-foreground">
          <Bot className="h-4 w-4" />
          <h2 className="text-lg font-semibold">Chat Defaults</h2>
        </div>

        <div className="mt-4 space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="default-model"
              className="text-sm font-medium text-foreground"
            >
              Default model
            </label>
            <Select
              id="default-model"
              value={selectedModel}
              onChange={(v) => setSelectedModel(v)}
              options={AVAILABLE_MODELS.map((model) => ({
                value: model.id,
                label: `${model.name} (${PROVIDER_LABELS[model.provider]})`,
              }))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${PROVIDER_BADGE_CLASSES[selectedModelConfig.provider]}`}
              >
                {PROVIDER_LABELS[selectedModelConfig.provider]}
              </span>
              <span className="text-xs text-tertiary/65">
                {selectedModelConfig.description}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-tertiary/10 bg-secondary/35 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Brain className="h-4 w-4" />
                  Long-term memory in chat
                </p>
                <p className="mt-1 text-xs text-tertiary/65">
                  Include saved memories during chat retrieval.
                </p>
              </div>
              <Checkbox
                id="memory-enabled"
                checked={memoryEnabled}
                onCheckedChange={setMemoryEnabled}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="theme-mode"
              className="text-sm font-medium text-foreground"
            >
              Theme
            </label>
            <Select
              id="theme-mode"
              value={theme}
              onChange={(v) => handleThemeChange(v)}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
            <div className="flex items-center gap-2 text-xs text-tertiary/65">
              {theme === "system" && <Monitor className="h-3.5 w-3.5" />}
              {theme === "light" && <Sun className="h-3.5 w-3.5" />}
              {theme === "dark" && <Moon className="h-3.5 w-3.5" />}
              <span>
                {theme === "system" && "Follow device preference"}
                {theme === "light" && "Light theme selected"}
                {theme === "dark" && "Dark theme selected"}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
