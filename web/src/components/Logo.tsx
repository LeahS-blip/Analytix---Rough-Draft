/** The KeepStat mark: a K whose kick is a rising chart line ending in a data point. */
export function LogoMark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="-6 -10 404 326" fill="none" aria-hidden="true">
      <path d="M2 64 Q2 52 13 45 L101 8 Q116 2 116 17 L116 146 L2 232 Z" fill="var(--ink)" />
      <path
        d="M8 312 L196 162 Q212 150 228 163 L389 294 Q397 304 384 312 L254 312 Q246 312 240 306 L172 236 L64 307 Q57 312 46 312 Z"
        fill="var(--ink)"
      />
      <path
        d="M2 270 L196 124 Q204 118 214 118 L254 118 Q262 118 268 112 L340 40"
        stroke="var(--accent)"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="352" cy="28" r="32" fill="var(--accent)" />
    </svg>
  );
}
