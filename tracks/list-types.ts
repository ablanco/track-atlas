/** Browser-safe private-list contracts; session and persistence stay server-side. */
export type TrackListSummary = {
  id: string;
  name: string;
  /** Tracks currently accessible to the list owner, not all memberships. */
  trackCount: number;
  createdAt: string;
};

export type TrackListIndex = {
  lists: TrackListSummary[];
  total: number;
  page: number;
  pageCount: number;
};

export type TrackListPicker = {
  lists: (TrackListSummary & { containsTrack: boolean })[];
};

export type TrackListErrorCode =
  | "invalidRequest"
  | "unauthorized"
  | "notFound"
  | "duplicateName"
  | "listLimit"
  | "trackLimit"
  | "unavailable";
