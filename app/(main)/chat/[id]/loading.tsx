export default function ChatLoading() {
  return (
    <div className="flex flex-1 flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl py-6 space-y-6 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
              <div
                className={`rounded-2xl ${i % 2 === 0 ? "bg-muted/30 max-w-[75%]" : "bg-muted/20 w-full"}`}
                style={{ height: i % 2 === 0 ? "3rem" : `${4 + (i % 3) * 2}rem` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
