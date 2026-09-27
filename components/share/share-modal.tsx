"use client";

import { logger } from "@/lib/logger";
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Share2,
  Copy,
  Check,
  Globe,
  Lock,
  Search,
  X,
  Users,
  User,
} from "lucide-react";
import { searchUsers, DirectoryUser } from "@/lib/ai-actions/user-actions";
import { UserAvatar } from "@/components/share/user-avatar";

interface SharedUser {
  id: string;
  displayName: string;
  email: string;
}

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  isShared: boolean;
  shareUrl: string | null;
  shareMode?: "public" | "specific";
  sharedWith?: SharedUser[];
  allowPublic?: boolean;
  onToggleShare: (
    enable: boolean,
    shareMode?: "public" | "specific",
    sharedWith?: SharedUser[],
  ) => void;
}

export function ShareModal({
  isOpen,
  onClose,
  isShared,
  shareUrl,
  shareMode = "public",
  sharedWith = [],
  allowPublic = true,
  onToggleShare,
}: ShareModalProps) {
  const [copied, setCopied] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [userResults, setUserResults] = React.useState<DirectoryUser[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [selectedUsers, setSelectedUsers] =
    React.useState<SharedUser[]>(sharedWith);
  const [currentShareMode, setCurrentShareMode] = React.useState<
    "public" | "specific"
  >(allowPublic ? shareMode : "specific");
  const [showDropdown, setShowDropdown] = React.useState(false);
  const searchRef = React.useRef<HTMLDivElement>(null);
  const searchTimeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined);
  const prevIsOpenRef = React.useRef(false);
  const resetSelectionState = React.useCallback(() => {
    setSelectedUsers(isShared ? sharedWith : []);
    setCurrentShareMode(allowPublic ? shareMode : "specific");
  }, [isShared, sharedWith, allowPublic, shareMode]);

  const resetSearchState = React.useCallback(() => {
    setSearchQuery("");
    setUserResults([]);
    setShowDropdown(false);
  }, []);

  const handleClose = React.useCallback(() => {
    resetSelectionState();
    resetSearchState();
    onClose();
  }, [onClose, resetSelectionState, resetSearchState]);

  React.useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      resetSelectionState();
      resetSearchState();
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, resetSelectionState, resetSearchState]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  React.useEffect(
    () => () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    },
    [],
  );

  const handleSearch = React.useCallback(
    async (query: string) => {
      if (query.trim().length < 2) {
        setUserResults([]);
        setShowDropdown(false);
        return;
      }

      setIsSearching(true);
      try {
        const results = await searchUsers(query);
        const filteredResults = results.filter(
          (user) => !selectedUsers.some((selected) => selected.id === user.id),
        );
        setUserResults(filteredResults);
        setShowDropdown(true);
      } catch (error) {
        logger.error("Error searching:", error);
        setUserResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [selectedUsers],
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(query);
    }, 300);
  };

  const handleSelectUser = (user: DirectoryUser) => {
    const newUser: SharedUser = {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
    };
    setSelectedUsers((prev) => [...prev, newUser]);
    setSearchQuery("");
    setUserResults([]);
    setShowDropdown(false);
  };

  const handleRemoveUser = (userId: string) => {
    setSelectedUsers((prev) => prev.filter((user) => user.id !== userId));
  };

  const handleCopy = async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    setIsLoading(true);
    try {
      await onToggleShare(
        true,
        currentShareMode,
        currentShareMode === "specific" ? selectedUsers : [],
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopSharing = async () => {
    setIsLoading(true);
    try {
      await onToggleShare(false);
    } finally {
      setIsLoading(false);
    }
  };

  const canShare =
    currentShareMode === "public" || selectedUsers.length > 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <DialogContent className="border border-modal-border/40 max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full border",
                isShared
                  ? "bg-green-500/10 border-green-500/20"
                  : "bg-tertiary/10 border-tertiary/20",
              )}
            >
              {isShared ? (
                <Globe className="h-5 w-5 text-green-500" />
              ) : (
                <Lock className="h-5 w-5 text-tertiary/50" />
              )}
            </div>
            <div>
              <DialogTitle className="text-tertiary">
                {allowPublic ? "Share Chat" : "Share Item"}
              </DialogTitle>
              <DialogDescription className="text-tertiary/60">
                {isShared
                  ? shareMode === "public"
                    ? allowPublic
                      ? "This item is available to everyone with the link"
                      : "This item is visible to all users"
                    : `Shared with ${sharedWith.length} user${
                        sharedWith.length !== 1 ? "s" : ""
                      }`
                  : "Private and only visible to you"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!isShared && (
          <>
            <div className="space-y-4">
              {allowPublic && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentShareMode("specific")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border transition-all",
                      currentShareMode === "specific"
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-tertiary/5 border-tertiary/10 text-tertiary/70 hover:bg-tertiary/10",
                    )}
                  >
                    <User className="h-4 w-4" />
                    <span className="text-sm font-medium">Specific Users</span>
                  </button>
                  <button
                    onClick={() => setCurrentShareMode("public")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border transition-all",
                      currentShareMode === "public"
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-tertiary/5 border-tertiary/10 text-tertiary/70 hover:bg-tertiary/10",
                    )}
                  >
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-medium">Share with All</span>
                  </button>
                </div>
              )}

              {currentShareMode === "specific" && (
                <div className="space-y-3">
                  <div ref={searchRef} className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary/40" />
                      <Input
                        placeholder="Search users by name or email..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        onFocus={() =>
                          userResults.length > 0 && setShowDropdown(true)
                        }
                        className="pl-9 bg-tertiary/5 border-tertiary/10"
                      />
                      {isSearching && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        </div>
                      )}
                    </div>

                    {/* User Results Dropdown */}
                    {showDropdown && userResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-tertiary/20 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                        {userResults.map((user) => (
                          <button
                            key={user.id}
                            onClick={() => handleSelectUser(user)}
                            className="w-full flex items-center gap-3 p-3 hover:bg-tertiary/10 transition-colors text-left"
                          >
                            <UserAvatar
                              userId={user.id}
                              displayName={user.displayName}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-tertiary truncate">
                                {user.displayName}
                              </p>
                              <p className="text-xs text-tertiary/60 truncate">
                                {user.email}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Selected Users */}
                  {selectedUsers.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-tertiary/60 font-medium">
                        Users:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedUsers.map((user) => (
                          <div
                            key={user.id}
                            className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full py-1 pl-1 pr-2"
                          >
                            <UserAvatar
                              userId={user.id}
                              displayName={user.displayName}
                              sizeClassName="h-6 w-6"
                              textClassName="text-xs"
                            />
                            <span className="text-sm text-tertiary">
                              {user.displayName}
                            </span>
                            <button
                              onClick={() => handleRemoveUser(user.id)}
                              className="h-4 w-4 rounded-full bg-tertiary/20 hover:bg-tertiary/40 flex items-center justify-center transition-colors"
                            >
                              <X className="h-3 w-3 text-tertiary" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedUsers.length === 0 && (
                    <p className="text-xs text-tertiary/50 text-center py-2">
                      Search and select users to share with
                    </p>
                  )}
                </div>
              )}

              {currentShareMode === "public" && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <Globe className="h-5 w-5 text-primary shrink-0" />
                  <p className="text-sm text-tertiary/80">
                    Anyone with the link will be able to view this chat.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {isShared && (
          <div className="space-y-4">
            {allowPublic && shareUrl && (
              <div className="space-y-2 animate-in fade-in duration-300">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    Public Link
                  </label>
                  {shareMode === "public" && (
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-green-500 uppercase tracking-wider bg-green-500/10 px-2 py-0.5 rounded-full">
                      <Globe className="h-3 w-3" />
                      Live
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 p-1.5 bg-tertiary/5 border border-tertiary/10 rounded-xl">
                  <Input
                    readOnly
                    value={shareUrl}
                    className="border-none bg-transparent shadow-none focus-visible:ring-0 text-xs h-8 text-tertiary/80"
                  />
                  <Button
                    size="sm"
                    onClick={handleCopy}
                    className={cn(
                      "h-8 px-3 rounded-lg transition-all",
                      copied
                        ? "bg-green-500 hover:bg-green-600 text-white"
                        : "bg-tertiary/10 hover:bg-tertiary/20 text-tertiary",
                    )}
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
            {sharedWith.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-tertiary/60 font-medium">
                  Shared with users:
                </p>
                <div className="flex flex-wrap gap-2">
                  {sharedWith.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-2 bg-tertiary/10 rounded-full py-1 pl-1 pr-3"
                    >
                      <UserAvatar
                        userId={user.id}
                        displayName={user.displayName}
                        sizeClassName="h-6 w-6"
                        textClassName="text-xs"
                      />
                      <span className="text-sm text-tertiary">
                        {user.displayName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          {isShared ? (
            <>
              <Button
                onClick={handleStopSharing}
                disabled={isLoading}
                variant="ghost"
                className="w-full gap-2 text-primary hover:bg-primary/10 border border-primary/20"
              >
                <Lock className="h-4 w-4" />
                {isLoading ? "Removing..." : "Stop Sharing"}
              </Button>
              <p className="text-xs text-tertiary/50 text-center">
                This will deactivate the link and make the chat private
              </p>
            </>
          ) : (
            <Button
              onClick={handleShare}
              disabled={isLoading || !canShare}
              className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" />
              {isLoading
                ? "Enabling..."
                : currentShareMode === "public"
                  ? "Share with Everyone"
                  : "Share with Selected"}
            </Button>
          )}

          <Button
            variant="ghost"
            onClick={handleClose}
            className="w-full text-tertiary/70 hover:text-tertiary hover:bg-tertiary/5"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
