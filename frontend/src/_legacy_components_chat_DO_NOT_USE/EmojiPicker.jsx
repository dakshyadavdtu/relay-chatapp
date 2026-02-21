import { useEffect, useRef } from "react";
import { cn } from "@/utils/utils";
import {
  Heart, Star, Flame, Zap, ThumbsUp, ThumbsDown, Smile, Laugh, Frown, Angry,
  PartyPopper, Trophy, Lightbulb, Rocket, Target, Coffee, BookOpen, Music,
  Gift, Check, Bell, Sun, Moon, Cloud,
} from "lucide-react";

const REACTIONS = [
  { icon: ThumbsUp, label: "thumbs up", text: "👍" },
  { icon: ThumbsDown, label: "thumbs down", text: "👎" },
  { icon: Heart, label: "heart", text: "❤️" },
  { icon: Star, label: "star", text: "⭐" },
  { icon: Flame, label: "fire", text: "🔥" },
  { icon: Zap, label: "zap", text: "⚡" },
  { icon: Smile, label: "smile", text: "😊" },
  { icon: Laugh, label: "laugh", text: "😂" },
  { icon: Frown, label: "sad", text: "😢" },
  { icon: Angry, label: "angry", text: "😠" },
  { icon: PartyPopper, label: "party", text: "🎉" },
  { icon: Trophy, label: "trophy", text: "🏆" },
  { icon: Lightbulb, label: "idea", text: "💡" },
  { icon: Rocket, label: "rocket", text: "🚀" },
  { icon: Target, label: "target", text: "🎯" },
  { icon: Coffee, label: "coffee", text: "☕" },
  { icon: BookOpen, label: "book", text: "📖" },
  { icon: Music, label: "music", text: "🎵" },
  { icon: Gift, label: "gift", text: "🎁" },
  { icon: Check, label: "check", text: "✅" },
  { icon: Bell, label: "bell", text: "🔔" },
  { icon: Sun, label: "sun", text: "☀️" },
  { icon: Moon, label: "moon", text: "🌙" },
  { icon: Cloud, label: "cloud", text: "☁️" },
];

export function EmojiPicker({ onSelect, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    };
    const handleEsc = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={cn(
        "bg-card border border-border rounded-xl shadow-xl w-[280px] max-h-[300px] overflow-y-auto custom-scrollbar p-3"
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Reactions</p>
      <div className="grid grid-cols-6 gap-1">
        {REACTIONS.map((r) => {
          const Icon = r.icon;
          return (
            <button
              key={r.text}
              className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
              onClick={() => onSelect?.(r.text)}
              title={r.label}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
