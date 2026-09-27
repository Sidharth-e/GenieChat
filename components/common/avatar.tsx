import Image from "next/image";
import { User } from "lucide-react";
import { useAuthStore } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface AvatarProps {
  className?: string;
  sizes?: string;
}

export const Avatar = ({ className, sizes = "36px" }: AvatarProps) => {
  const user = useAuthStore((state) => state.user);
  return (
    <div
      className={cn(
        "relative h-9 w-9 overflow-hidden rounded-full ring-2 ring-tertiary/10",
        className,
      )}
    >
      {user?.image ? (
        <Image
          src={user.image}
          alt={user.name || "User avatar"}
          fill
          sizes={sizes}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-tertiary/5">
          <User className="h-4 w-4 text-tertiary/50" />
        </div>
      )}
    </div>
  );
};
