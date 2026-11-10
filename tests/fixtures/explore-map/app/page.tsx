"use client";

import { Activity, useCallback, useState } from "react";
import { useTheme } from "next-themes";
import { Toaster } from "../../../../components/ui/toast";
import { TrackMap } from "../../../../components/track-map";
import { NextIntlClientProvider } from "next-intl";
import es from "../../../../messages/es.json";
import en from "../../../../messages/en.json";
import fr from "../../../../messages/fr.json";
import pt from "../../../../messages/pt.json";
import de from "../../../../messages/de.json";
import it from "../../../../messages/it.json";

import { ExploreSpatialControls } from "../../../../components/explore-spatial-controls";
import { ExploreMap } from "../../../../components/explore-map";
import { getExploreTrackColor } from "../../../../tracks/explore-map";
import type {
  ExploreDrawing,
  ExploreViewport,
  ExploreGeometryStatus,
} from "../../../../tracks/explore-types";

const catalogs = { en, es, fr, pt, de, it };

const initial = ["one", "two"].map((id, index) => ({
  id,
  name: `Track ${id}`,
  color: getExploreTrackColor(index),
}));
export default function Harness() {
  const { setTheme } = useTheme();
  const [details, setDetails] = useState(false);
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
  const [freshTracks, setFreshTracks] = useState(false);
  const [viewportReports, setViewportReports] = useState(0);
  const [selectedId, onSelect] = useState<string | null>(null);
  const [highlightedId, setHighlighted] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, ExploreGeometryStatus>>(
    {},
  );
  const [retry, setRetry] = useState<{ id: string; attempt: number } | null>(
    null,
  );
  const [visible, setVisible] = useState(true);
  const [locale, setLocale] = useState<keyof typeof catalogs>("en");
  const onStatus = useCallback(
    (id: string, value: ExploreGeometryStatus) =>
      setStatus((current) => ({ ...current, [id]: value })),
    [],
  );
  return (
    <NextIntlClientProvider
      timeZone="UTC"
      locale={locale}
      messages={catalogs[locale]}
    >
      <Toaster />
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
      <button onClick={() => setFreshTracks(true)}>
        Fresh track snapshots
      </button>
      <output aria-label="Viewport reports">{viewportReports}</output>
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
      <button
        onClick={() => setLocale((current) => (current === "es" ? "en" : "es"))}
      >
        Language
      </button>
      {(Object.keys(catalogs) as (keyof typeof catalogs)[]).map((language) => (
        <button key={language} onClick={() => setLocale(language)}>
          Locale {language}
        </button>
      ))}
      <button onClick={() => setTheme("dark")}>Dark</button>
      <button onClick={() => setTheme("light")}>Light</button>
      <button onClick={() => setTheme("system")}>System</button>
      <button onClick={() => setDetails((current) => !current)}>
        Toggle details
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
          {details ? (
            <TrackMap id="one" />
          ) : (
            <ExploreMap
              controls={
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
                    if (spatial.drawing !== undefined)
                      setDrawing(spatial.drawing);
                    if (spatial.viewport !== undefined)
                      setViewport(spatial.viewport);
                  }}
                />
              }
              tracks={
                freshTracks ? tracks.map((track) => ({ ...track })) : tracks
              }
              selectedId={selectedId}
              highlightedId={highlightedId}
              onSelect={onSelect}
              onStatus={onStatus}
              retry={retry}
              spatial={{ viewport, drawing, restoreKey }}
              drawRequest={drawRequest}
              onDrawing={setDrawing}
              onPlacementMode={setPlacementMode}
              onViewport={(value) => {
                setCurrentViewport(value);
                setViewportReports((count) => count + 1);
              }}
            />
          )}
        </Activity>
      </div>
    </NextIntlClientProvider>
  );
}
