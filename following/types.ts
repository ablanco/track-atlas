import type { SupportedLocale } from "../i18n/locales";
export type FollowState = { following: boolean; eligible: boolean };
export type FollowingItem = {
  id: string;
  /** Null means inactive: the UI must use a localized generic label. */
  displayName: string | null;
  active: boolean;
  avatarUrl: string | null;
  collectionUrl: string | null;
  followedAt: string;
};
export type FollowingPage = {
  items: FollowingItem[];
  total: number;
  page: number;
  pages: number;
};
export type DigestPreferences = {
  enabled: boolean;
  locale: SupportedLocale | null;
};
export type FollowingErrorCode =
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "invalidRequest"
  | "tooLarge"
  | "unavailable";
