"use client";

import { Activity, useCallback, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import es from "../../../../messages/es.json";
import en from "../../../../messages/en.json";
import { ExploreSpatialControls } from "../../../../components/explore-spatial-controls";
import { ExploreMap } from "../../../../components/explore-map";
import { getExploreTrackColor } from "../../../../tracks/explore-map";
import type {
  ExploreDrawing,
  ExploreViewport,
  ExploreGeometryStatus,
} from "../../../../tracks/explore-types";

const initial = ["one", "two"].map((id, index) => ({
  id,
  name: `Track ${id}`,
  number: index + 1,
  color: getExploreTrackColor(index),
}));
export default function Harness() {
  const [restoreKey, setRestoreKey] = useState(0);
  const [drawing, setDrawing] = useState<ExploreDrawing | null>(null);
  const [viewport, setViewport] = useState<ExploreViewport | null>(null);
  const [currentViewport, setCurrentViewport] =
    useState<ExploreViewport | null>(null);
  const [placementMode, setPlacementMode] = useState<
    ExploreDrawing["mode"] | null
  >(null);
  const [drawRequest, setDrawRequest] = useState<{
    id: number;
    mode: ExploreDrawing["mode"];
  } | null>(null);
  const [tracks, setTracks] = useState(initial);
  const [selectedId, onSelect] = useState<string | null>(null);
  const [highlightedId, setHighlighted] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, ExploreGeometryStatus>>(
    {},
  );
  const [retry, setRetry] = useState<{ id: string; attempt: number } | null>(
    null,
  );
  const [visible, setVisible] = useState(true);
  const [spanish, setSpanish] = useState(false);
  const onStatus = useCallback(
    (id: string, value: ExploreGeometryStatus) =>
      setStatus((current) => ({ ...current, [id]: value })),
    [],
  );
  return (
    <NextIntlClientProvider
      timeZone="UTC"
      locale={spanish ? "es" : "en"}
      messages={spanish ? es : en}
    >
      <ExploreSpatialControls
        viewport={viewport}
        drawing={drawing}
        placementMode={placementMode}
        currentViewport={currentViewport}
        disabled={false}
        onDraw={(mode) => {
          setPlacementMode(mode);
          setDrawRequest({ id: Date.now(), mode });
        }}
        onChange={(spatial) => {
          if (spatial.drawing !== undefined) setDrawing(spatial.drawing);
          if (spatial.viewport !== undefined) setViewport(spatial.viewport);
        }}
      />
      <button
        onClick={() =>
          setDrawing({
            mode: "arrow",
            start: [179, 0],
            end: [-179, 0],
            corridorKm: 1,
          })
        }
      >
        Date line drawing
      </button>
      <button
        onClick={() =>
          setDrawing({
            mode: "arrow",
            start: [0, 0],
            end: [179.9, 0.1],
            corridorKm: 1,
          })
        }
      >
        Near antipodal drawing
      </button>
      <button
        onClick={() => {
          setViewport({ west: 170, south: -20, east: -170, north: 20 });
          setRestoreKey((k) => k + 1);
        }}
      >
        Restore viewport
      </button>
      <button
        onClick={() => {
          setViewport(null);
          setDrawing({
            mode: "line",
            start: [179, 0],
            end: [-179, 0],
            corridorKm: 1,
          });
          setRestoreKey((k) => k + 1);
        }}
      >
        Restore corridor
      </button>
      <output aria-label="Camera bounds">
        {JSON.stringify(currentViewport)}
      </output>
      <output aria-label="Committed drawing">{JSON.stringify(drawing)}</output>
      <button
        onClick={() =>
          setTracks([
            {
              id: "three",
              name: "Track three",
              number: 1,
              color: getExploreTrackColor(0),
            },
          ])
        }
      >
        Next results
      </button>
      <button
        onClick={() =>
          setTracks(
            Array.from({ length: 10 }, (_, i) => ({
              id: `max-${i}`,
              name: `Maximum ${i + 1}`,
              number: i + 1,
              color: getExploreTrackColor(i),
            })),
          )
        }
      >
        Full page
      </button>
      <button
        onClick={() =>
          setRetry((current) => ({
            id: "two",
            attempt: (current?.attempt ?? 0) + 1,
          }))
        }
      >
        Retry two
      </button>
      <button onClick={() => setVisible((current) => !current)}>
        Toggle activity
      </button>
      <button onClick={() => setSpanish((current) => !current)}>
        Language
      </button>
      <button onClick={() => (document.documentElement.dataset.theme = "dark")}>
        Dark
      </button>
      <output aria-label="Selected">{selectedId}</output>
      {tracks.map((track) => (
        <button
          key={track.id}
          onFocus={() => setHighlighted(track.id)}
          onBlur={() => setHighlighted(null)}
          onMouseEnter={() => setHighlighted(track.id)}
          onMouseLeave={() => setHighlighted(null)}
          onClick={() => onSelect(track.id)}
        >
          {track.name}: {status[track.id]}
        </button>
      ))}
      <div style={{ height: 600 }}>
        <Activity mode={visible ? "visible" : "hidden"}>
          <ExploreMap
            tracks={tracks}
            selectedId={selectedId}
            highlightedId={highlightedId}
            onSelect={onSelect}
            onStatus={onStatus}
            retry={retry}
            spatial={{ viewport, drawing, restoreKey }}
            drawRequest={drawRequest}
            onDrawing={setDrawing}
            onPlacementMode={setPlacementMode}
            onViewport={setCurrentViewport}
          />
        </Activity>
      </div>
    </NextIntlClientProvider>
  );
}
