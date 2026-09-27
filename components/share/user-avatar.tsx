"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";

interface UserAvatarProps {
  userId: string;
  displayName: string;
  /** Tailwind size classes, defaults to h-8 w-8 */
  sizeClassName?: string;
  /** Tailwind text-size class for initials, defaults to text-sm */
  textClassName?: string;
}

/**
 * Renders a user's profile photo fetched from the `/api/user-photo/[userId]`
 * proxy route. Falls back to a coloured circle with the user's initial when
 * the photo is unavailable.
 */
export function UserAvatar({
  userId,
  displayName,
  sizeClassName = "h-8 w-8",
  textClassName = "text-sm",
}: UserAvatarProps) {
  const [photoError, setPhotoError] = React.useState(false);
  const initial = displayName.charAt(0).toUpperCase();

  if (!photoError) {
    return (
      <Image
        width={50}
        height={50}
        unoptimized
        src={`/api/user-photo/${userId}`}
        alt={displayName}
        onError={() => setPhotoError(true)}
        className={cn("rounded-full object-cover", sizeClassName)}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium",
        sizeClassName,
        textClassName,
      )}
    >
      {initial}
    </div>
  );
}
