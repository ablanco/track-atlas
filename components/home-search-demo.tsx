"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./homepage.module.css";

const modes = ["viewport", "arrow", "line"] as const;
type Mode = (typeof modes)[number];

export function PreviewMap({ mode = "arrow" }: { mode?: Mode }) {
  const t = useTranslations("Home");
  return (
    <svg
      viewBox="0 0 640 460"
      role="img"
      aria-label={t("mapLabel")}
      className={styles.map}
    >
      <rect width="640" height="460" fill="var(--land)" />
      <g fill="none" stroke="var(--contour)" strokeWidth="1.2" opacity=".65">
        {Array.from({ length: 12 }, (_, i) => (
          <ellipse
            key={i}
            cx="480"
            cy="110"
            rx={60 + i * 24}
            ry={35 + i * 19}
            transform="rotate(-28 480 110)"
          />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <ellipse
            key={i}
            cx="75"
            cy="410"
            rx={45 + i * 23}
            ry={25 + i * 17}
            transform="rotate(-35 75 410)"
          />
        ))}
      </g>
      <path
        d="M290 -20 C220 100 400 135 310 245 S280 350 380 480"
        fill="none"
        stroke="var(--water)"
        strokeWidth="35"
      />
      <g fill="none" stroke="#fff" strokeWidth="3" opacity=".55">
        <path d="M0 150 Q170 100 290 200 T640 320" />
        <path d="M110 0 Q200 160 160 270 T190 460" />
        <path d="M0 360 Q160 260 340 320 T640 410" />
      </g>
      {mode === "viewport" ? (
        <rect
          x="105"
          y="80"
          width="410"
          height="295"
          rx="10"
          fill="#f36b2b"
          fillOpacity=".09"
          stroke="#c64a0c"
          strokeWidth="3"
          strokeDasharray="9 7"
        />
      ) : (
        <path
          d="M140 335 L490 130"
          stroke="#f36b2b"
          strokeWidth="80"
          opacity=".18"
          strokeLinecap="round"
        />
      )}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M110 335 Q170 315 185 245 T315 200 Q360 185 380 140 T505 105"
          stroke="white"
          strokeWidth="10"
        />
        <path
          d="M110 335 Q170 315 185 245 T315 200 Q360 185 380 140 T505 105"
          stroke="#137b69"
          strokeWidth="5"
        />
        <path
          d="M510 185 Q430 200 420 265 T290 300 Q245 305 230 365"
          stroke="white"
          strokeWidth="9"
        />
        <path
          d="M510 185 Q430 200 420 265 T290 300 Q245 305 230 365"
          stroke="#073b53"
          strokeWidth="4"
          opacity={mode === "arrow" ? ".22" : "1"}
        />
        <path
          d="M65 95 Q160 55 215 105 T310 90"
          stroke="white"
          strokeWidth="8"
        />
        <path
          d="M65 95 Q160 55 215 105 T310 90"
          stroke="#0d5f66"
          strokeWidth="4"
          opacity={mode === "viewport" ? "1" : ".22"}
        />
        {mode !== "viewport" && (
          <>
            <path
              d="M140 335 L490 130"
              stroke="#a63b0a"
              strokeWidth="4"
              strokeDasharray="9 7"
            />
            {mode === "arrow" && (
              <path
                d="M459 131 L490 130 L477 158"
                stroke="#a63b0a"
                strokeWidth="5"
              />
            )}
          </>
        )}
      </g>
      {[
        { x: 110, y: 335, n: 1 },
        { x: 510, y: 185, n: 2 },
        { x: 65, y: 95, n: 3 },
      ].map((p) => (
        <g key={p.n}>
          <circle
            cx={p.x}
            cy={p.y}
            r="14"
            fill="#073b53"
            stroke="white"
            strokeWidth="3"
          />
          <text
            x={p.x}
            y={p.y + 4}
            fill="white"
            fontSize="12"
            fontWeight="700"
            textAnchor="middle"
          >
            {p.n}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function HomeSearchDemo() {
  const t = useTranslations("Home.search");
  const [mode, setMode] = useState<Mode>("viewport");
  const id = useId();
  return (
    <div className={styles.demo}>
      <div role="tablist" aria-label={t("label")} className={styles.tabs}>
        {modes.map((value, i) => (
          <button
            key={value}
            role="tab"
            id={`${id}-${value}`}
            aria-controls={`${id}-panel`}
            aria-selected={mode === value}
            tabIndex={mode === value ? 0 : -1}
            onClick={() => setMode(value)}
            onKeyDown={(event) => {
              const index =
                event.key === "ArrowRight"
                  ? (i + 1) % 3
                  : event.key === "ArrowLeft"
                    ? (i + 2) % 3
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : -1;
              if (index < 0) return;
              event.preventDefault();
              setMode(modes[index]);
              document.getElementById(`${id}-${modes[index]}`)?.focus();
            }}
          >
            {t(value)}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${mode}`}
        tabIndex={0}
      >
        <PreviewMap mode={mode} />
        <div className={styles.demoCaption}>
          <strong>{t(mode)}</strong>
          <p>{t(`${mode}Text`)}</p>
          <span>
            {t("selected")} ·{" "}
            {t("matches", {
              count: mode === "arrow" ? 1 : mode === "line" ? 2 : 3,
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
