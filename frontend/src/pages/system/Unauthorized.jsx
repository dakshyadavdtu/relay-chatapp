import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Unauthorized() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6">
      <h1 className="text-2xl font-bold">Access denied</h1>
      <p className="text-muted-foreground text-sm text-center max-w-sm">
        You don&apos;t have permission to view this page.
      </p>
      <p className="text-muted-foreground text-xs text-center max-w-sm">
        If you believe this is an error, contact the system administrator.
      </p>
      <Link href="/chat">
        <Button variant="outline">Back to Chat</Button>
      </Link>
    </div>
  );
}
