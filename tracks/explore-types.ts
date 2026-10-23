import type { ActivityType } from "./validation";

export type ExploreVisibility = "all" | "public" | "private";

/** Geographic positions are [longitude, latitude] in degrees, never screen pixels. */
export type ExplorePosition = [number, number];
export type ExploreViewport = {
  west: number;
  south: number;
  east: number;
  north: number;
};
export type ExploreDrawing = {
  mode: "arrow" | "line";
  start: ExplorePosition;
  end: ExplorePosition;
  corridorKm: number;
};

export type ExploreFilters = {
  q: string;
  activities: ActivityType[];
  difficulties: number[];
  minDistanceKm: number | null;
  maxDistanceKm: number | null;
  maxElevationRangeMeters: number | null;
  visibility: ExploreVisibility;
  page: number;
  viewport?: ExploreViewport | null;
  drawing?: ExploreDrawing | null;
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
  isBookmarked?: boolean;
};

export type ExploreResult = {
  tracks: ExploreTrack[];
  total: number;
  page: number;
  pageCount: number;
  scopeCount: number;
  bounds: { maxDistanceKm: number; maxElevationRangeMeters: number };
  list?: { id: string; name: string } | null;
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
  spatial?: {
    viewport?: ExploreViewport | null;
    drawing?: ExploreDrawing | null;
    restoreKey?: number;
  };
  drawRequest?: { id: number; mode: ExploreDrawing["mode"] } | null;
  onDrawing?: (drawing: ExploreDrawing) => void;
  onPlacementMode?: (mode: ExploreDrawing["mode"] | null) => void;
  onViewport?: (viewport: ExploreViewport, intentional: boolean) => void;
};
