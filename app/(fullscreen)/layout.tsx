/**
 * The `(fullscreen)` group renders edge to edge: no nav rail, no inspector
 * panels. The height is what the frames inside the group need — an editor like
 * `AgentForm` is `h-full` and owns its own scroll, so it needs an ancestor with a
 * definite height to resolve against.
 */
export default function FullscreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen overflow-hidden bg-background">{children}</div>
  );
}
