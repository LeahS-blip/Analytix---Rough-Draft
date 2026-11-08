export function LogoMark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 30 26" fill="none" aria-hidden="true">
      <rect x="0" y="16" width="5" height="10" rx="1.4" fill="var(--faint)" />
      <rect x="7" y="11" width="5" height="15" rx="1.4" fill="var(--muted)" />
      <rect x="14" y="6" width="5" height="20" rx="1.4" fill="var(--ink)" />
      <rect x="21" y="0" width="5" height="26" rx="1.4" fill="var(--accent)" />
    </svg>
  );
}
