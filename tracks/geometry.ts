/** Browser-safe shared recorded-path and chart-input contract. */
export type TrackPosition = [number, number];
export type TrackLineString = {
  type: "LineString";
  coordinates: TrackPosition[];
};
export type TrackMultiLineString = {
  type: "MultiLineString";
  coordinates: TrackPosition[][];
};
export type TrackSample = {
  distanceMeters: number;
  elevationMeters: number | null;
  speedMps: number | null;
};
export type TrackDataPayload = {
  geometry: TrackMultiLineString;
  samples: TrackSample[];
  /** Zero-based sample indices in document order; one entry per geometry part. */
  segmentStarts: number[];
};

export type WaypointCategory =
  | "generic"
  | "drinkingWater"
  | "shelter"
  | "viewpoint"
  | "parking"
  | "food"
  | "accommodation"
  | "campsite"
  | "summit"
  | "toilets"
  | "shower"
  | "picnicArea"
  | "information"
  | "warning"
  | "restrictedArea"
  | "waterSource"
  | "pharmacy"
  | "supplies"
  | "fuel"
  | "vehicleRepair"
  | "forest"
  | "park"
  | "beach"
  | "bridge"
  | "cyclingTrail"
  | "telephone"
  | "anchorage"
  | "bank"
  | "building"
  | "car"
  | "crossing"
  | "exit"
  | "transport"
  | "house"
  | "road"
  | "tunnel";

/** Standalone POIs, exposed only by authorized Track detail reads. */
export type TrackWaypoint = {
  position: TrackPosition;
  name: string;
  description: string;
  category: WaypointCategory;
};
