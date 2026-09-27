"use client";

export function AgentChatSkeleton() {
  return (
    <div className="flex h-full flex-col animate-pulse">
      {/* Main Content - Agent Welcome Screen Skeleton */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-12 overflow-y-auto">
        <div className="text-center space-y-8 max-w-3xl w-full">
          {/* Agent Icon Skeleton */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="h-20 w-20 rounded-2xl bg-foreground/10 flex items-center justify-center shadow-sm">
                <div className="h-10 w-10 bg-foreground/5 rounded-full" />
              </div>
              <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-foreground/10 border-2 border-background" />
            </div>
          </div>

          {/* Agent Info Skeleton */}
          <div className="space-y-4 flex flex-col items-center">
            <div className="h-9 bg-foreground/10 rounded-lg w-48" />
            <div className="space-y-2 flex flex-col items-center">
              <div className="h-4 bg-foreground/10 rounded w-64" />
              <div className="h-4 bg-foreground/10 rounded w-48" />
            </div>
          </div>

          {/* Quick Tips Skeleton */}
          <div className="flex flex-wrap justify-center gap-2">
            <div className="h-7 w-28 bg-foreground/10 rounded-full" />
            <div className="h-7 w-24 bg-foreground/10 rounded-full" />
          </div>
        </div>
      </main>

      {/* Input Area Skeleton */}
      <div className="px-4 pb-6 pt-4">
        <div className="relative w-full max-w-3xl mx-auto">
          <div className="relative flex flex-col rounded-[26px] bg-foreground/5 border border-foreground/10">
            {/* Text Input Area Skeleton */}
            <div className="flex items-end px-3 sm:px-4 pt-4 pb-2">
              <div className="min-h-[50px] w-full bg-transparent" />
            </div>

            {/* Bottom Action Bar Skeleton */}
            <div className="flex items-center justify-between px-3 sm:px-4 pb-2">
              {/* Left Actions */}
              <div className="flex items-center gap-1">
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
              </div>

              {/* Right Actions */}
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MultiAgentChatSkeleton() {
  return (
    <div className="flex h-full flex-col animate-pulse">
      {/* Main Content - Multi-Agent Welcome Screen Skeleton */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-12 overflow-y-auto">
        <div className="text-center space-y-8 max-w-3xl w-full">
          {/* Agent Icon Skeleton */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="h-20 w-20 rounded-2xl bg-foreground/10 flex items-center justify-center shadow-sm transform rotate-3">
                <div className="h-10 w-10 bg-foreground/5 rounded-full" />
              </div>
              <div className="absolute -top-2 -left-2 h-8 w-8 rounded-xl bg-foreground/10 flex items-center justify-center shadow-sm transform -rotate-6">
                <div className="h-5 w-5 bg-foreground/5 rounded-full" />
              </div>
            </div>
          </div>

          {/* Agent Info Skeleton */}
          <div className="space-y-4 flex flex-col items-center">
            <div className="h-9 bg-foreground/10 rounded-lg w-64" />
            <div className="space-y-2 flex flex-col items-center">
              <div className="h-4 bg-foreground/10 rounded w-72" />
              <div className="h-4 bg-foreground/10 rounded w-56" />
            </div>
            <div className="h-3 bg-foreground/10 rounded w-32" />
          </div>

          {/* Quick Tips Skeleton */}
          <div className="flex flex-wrap justify-center gap-2">
            <div className="h-7 w-20 bg-foreground/10 rounded-full" />
            <div className="h-7 w-24 bg-foreground/10 rounded-full" />
            <div className="h-7 w-22 bg-foreground/10 rounded-full" />
          </div>
        </div>
      </main>

      {/* Input Area Skeleton */}
      <div className="px-4 pb-6 pt-4">
        <div className="relative w-full max-w-3xl mx-auto">
          <div className="relative flex flex-col rounded-[26px] bg-foreground/5 border border-foreground/10">
            {/* Text Input Area Skeleton */}
            <div className="flex items-end px-3 sm:px-4 pt-4 pb-2">
              <div className="min-h-[50px] w-full bg-transparent" />
            </div>

            {/* Bottom Action Bar Skeleton */}
            <div className="flex items-center justify-between px-3 sm:px-4 pb-2">
              {/* Left Actions */}
              <div className="flex items-center gap-1">
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
              </div>

              {/* Right Actions */}
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConversationSkeleton() {
  return (
    <div className="flex h-full flex-col lg:pt-[60px] animate-pulse">
      {/* Messages Area Skeleton */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-3xl py-10 space-y-8 px-4">
          {/* User Message Skeleton */}
          <div className="flex flex-col items-end space-y-2">
            <div className="h-16 w-2/3 bg-foreground/10 rounded-2xl" />
            <div className="h-3 w-24 bg-foreground/5 rounded" />
          </div>

          {/* Assistant Message Skeleton */}
          <div className="flex flex-col items-start space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-foreground/10" />
              <div className="h-4 w-32 bg-foreground/10 rounded" />
            </div>
            <div className="space-y-2 w-full">
              <div className="h-4 w-full bg-foreground/10 rounded" />
              <div className="h-4 w-[90%] bg-foreground/10 rounded" />
              <div className="h-4 w-[95%] bg-foreground/10 rounded" />
              <div className="h-4 w-1/2 bg-foreground/10 rounded" />
            </div>
            <div className="h-3 w-24 bg-foreground/5 rounded" />
          </div>

          {/* User Message Skeleton */}
          <div className="flex flex-col items-end space-y-2">
            <div className="h-12 w-1/2 bg-foreground/10 rounded-2xl" />
            <div className="h-3 w-24 bg-foreground/5 rounded" />
          </div>

          {/* Assistant Message Skeleton */}
          <div className="flex flex-col items-start space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-foreground/10" />
              <div className="h-4 w-32 bg-foreground/10 rounded" />
            </div>
            <div className="space-y-2 w-full">
              <div className="h-4 w-full bg-foreground/10 rounded" />
              <div className="h-4 w-3/4 bg-foreground/10 rounded" />
            </div>
            <div className="h-3 w-24 bg-foreground/5 rounded" />
          </div>
        </div>
      </main>

      {/* Input Area Skeleton */}
      <div className="px-4 pb-6 pt-4">
        <div className="relative w-full max-w-3xl mx-auto">
          <div className="relative flex flex-col rounded-[26px] bg-foreground/5 border border-foreground/10">
            {/* Text Input Area Skeleton */}
            <div className="flex items-end px-3 sm:px-4 pt-4 pb-2">
              <div className="min-h-[50px] w-full bg-transparent" />
            </div>

            {/* Bottom Action Bar Skeleton */}
            <div className="flex items-center justify-between px-3 sm:px-4 pb-2">
              {/* Left Actions */}
              <div className="flex items-center gap-1">
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
              </div>

              {/* Right Actions */}
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
                <div className="h-7 w-7 rounded-full bg-foreground/10" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
