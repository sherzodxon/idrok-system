// The school's mark (a sun rising over an open book), drawn in currentColor so tokens colour it.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="120 120 400 400" className={className} aria-hidden="true" focusable="false">
      <path
        d="M366.2 355.9L454 319.5M355.4 339.6L422.5 272.5M339.1 328.8L375.5 241M320 325V230M300.9 328.8L264.5 241M284.6 339.6L217.5 272.5M273.8 355.9L186 319.5"
        stroke="currentColor"
        strokeWidth="15"
        fill="none"
      />
      <ellipse cx="320" cy="375" rx="40" ry="28" fill="currentColor" />
      <path d="M168 368h304v20H356q-29 2-29 24h-15q0-22-28-24H168z" fill="currentColor" />
    </svg>
  );
}

/** The mark on the brand colour, as on the school's logo. */
export function BrandBadge({ className }: { className: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center bg-brand text-on-brand ${className}`}>
      <BrandMark className="size-full" />
    </span>
  );
}
