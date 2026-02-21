/**
 * DO NOT USE — Legacy placeholder chat UI.
 * The real chat is src/features/chat (ChatRoot). Do not route to this file.
 * Quarantined in Phase C2; kept only to avoid breaking any stray imports.
 */

export default function ChatPlaceholder() {
  return (
    <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
      Legacy ChatPlaceholder (unused). Real chat is in src/features/chat/.
    </div>
  );
}
