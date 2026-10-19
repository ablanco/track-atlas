export function TrackIllustration({ label }: { label: string }) {
  const track =
    "M90 276L112 240L95 210L145 180L160 125L205 103L242 127L271 92L330 72";

  return (
    <svg
      data-map
      role="img"
      aria-label={label}
      viewBox="0 0 470 390"
      fill="none"
      className="block h-auto w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="470" height="390" fill="var(--map-background)" />
      <g stroke="var(--map-contour)" strokeWidth="1.3">
        {Array.from({ length: 15 }, (_, index) => (
          <path
            key={index}
            d={`M-40 ${90 + index * 20}Q80 ${-50 + index * 20} 190 ${80 + index * 20}T510 ${50 + index * 20}`}
          />
        ))}
      </g>
      <path
        d="M340-20Q280 70 330 150T300 410"
        stroke="var(--map-water)"
        strokeWidth="22"
      />
      <path
        d={track}
        stroke="var(--map-track-outline)"
        strokeWidth="9"
        strokeLinejoin="round"
      />
      <path
        data-track
        d={track}
        stroke="var(--map-track-primary)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M90 276L170 290L205 249L250 260L295 214L354 232L390 195"
        stroke="var(--map-track-secondary)"
        strokeWidth="4"
        strokeDasharray="7 5"
        strokeLinejoin="round"
      />
      <circle
        cx="90"
        cy="276"
        r="7"
        fill="var(--map-track-outline)"
        stroke="var(--map-track-primary)"
        strokeWidth="3"
      />
      <circle cx="330" cy="72" r="6" fill="var(--map-track-primary)" />
    </svg>
  );
}
