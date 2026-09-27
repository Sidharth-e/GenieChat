export interface Announcement {
  id: string;
  title: string;
  description: string;
  body: string[];
  ctaLabel?: string;
  enabled?: boolean;
}

export const ANNOUNCEMENTS: Announcement[] = [];
