import type { ActivityType } from "./validation";

export type ExploreVisibility = "all" | "public" | "private";

export type ExploreFilters = {
  q: string;
  activities: ActivityType[];
  difficulties: number[];
  minDistanceKm: number | null;
  maxDistanceKm: number | null;
  maxElevationRangeMeters: number | null;
  visibility: ExploreVisibility;
  page: number;
};

export type ExploreOwner = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type ExploreTrack = {
  id: string;
  name: string;
  activity: ActivityType;
  difficulty: number;
  distanceMeters: number;
  visibility: "public" | "private";
  owner: ExploreOwner;
};

export type ExploreResult = {
  tracks: ExploreTrack[];
  total: number;
  page: number;
  pageCount: number;
  scopeCount: number;
  bounds: { maxDistanceKm: number; maxElevationRangeMeters: number };
  collection: (ExploreOwner & { isOwner: boolean }) | null;
  filters: ExploreFilters;
};

export type ExploreMapTrack = {
  id: string;
  name: string;
  color: string;
  number: number;
};

export type ExploreGeometryStatus = "loading" | "ready" | "error";

export type ExploreMapProps = {
  tracks: ExploreMapTrack[];
  selectedId: string | null;
  highlightedId: string | null;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: ExploreGeometryStatus) => void;
  retry: { id: string; attempt: number } | null;
};
