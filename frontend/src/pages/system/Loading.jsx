import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <Spinner size="lg" />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  );
}
