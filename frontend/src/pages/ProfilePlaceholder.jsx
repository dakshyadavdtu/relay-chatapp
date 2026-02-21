import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function ProfilePlaceholder() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6">
      <div>Profile Placeholder</div>
      <Link href="/chat">
        <Button variant="outline" size="sm">Back to Chat</Button>
      </Link>
    </div>
  );
}
