"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { UserStore } from "@/lib/mongodb/user-store";
import { logger } from "@/lib/logger";

const userStore = isDatabaseConfigured() ? new UserStore() : null;

// Enforced in the database query (`UserStore.searchUsers`), not after the
// fetch: the share picker only ever shows a handful of results at a time.
const MAX_RESULTS = 25;

export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string;
}

/**
 * Directory search for the share picker. Reads the local `users` collection
 * rather than Microsoft Graph, which the GitHub sign-in flow no longer has a
 * token for.
 */
export async function searchUsers(query: string): Promise<DirectoryUser[]> {
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    return [];
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return [];
  }

  if (!userStore) {
    return [];
  }

  try {
    const users = await userStore.searchUsers(trimmed, MAX_RESULTS);

    return users.map((user) => ({
      id: user.id,
      displayName: user.name,
      email: user.email,
    }));
  } catch (error) {
    logger.error("Error searching directory users:", error);
    return [];
  }
}
