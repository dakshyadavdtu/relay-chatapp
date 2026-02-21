import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground text-sm">The page you're looking for doesn't exist.</p>
      <Link href="/chat">
        <Button variant="outline">Go to Chat</Button>
      </Link>
    </div>
  );
}
