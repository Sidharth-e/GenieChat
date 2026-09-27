export default function MainLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="h-full w-full overflow-y-auto p-6 md:p-8 md:pt-20"
    >
      <div className="mx-auto w-full max-w-6xl space-y-6 animate-pulse">
        <div className="h-8 w-48 rounded-lg bg-muted/40" />
        <div className="h-11 w-full rounded-xl bg-muted/30" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="h-40 rounded-2xl bg-muted/25" />
          <div className="h-40 rounded-2xl bg-muted/25" />
          <div className="h-40 rounded-2xl bg-muted/25" />
          <div className="h-40 rounded-2xl bg-muted/25" />
          <div className="h-40 rounded-2xl bg-muted/25" />
          <div className="h-40 rounded-2xl bg-muted/25" />
        </div>
      </div>
    </div>
  );
}
