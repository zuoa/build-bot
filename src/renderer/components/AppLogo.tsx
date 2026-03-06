interface AppLogoProps {
  compact?: boolean;
}

export default function AppLogo({ compact = false }: AppLogoProps): JSX.Element {
  return (
    <div className={`app-logo ${compact ? 'is-compact' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 80 80" role="img">
        <defs>
          <linearGradient id="ga-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#d96a3f" />
            <stop offset="100%" stopColor="#2b6a67" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="72" height="72" rx="18" fill="url(#ga-gradient)" />
        <path
          d="M40 20c4.4 0 8 3.6 8 8v8h8c4.4 0 8 3.6 8 8s-3.6 8-8 8h-4"
          fill="none"
          stroke="#fffaf1"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="56" cy="44" r="4" fill="#fffaf1" />
        <path
          d="M24 54V26h16"
          fill="none"
          stroke="#fffaf1"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>BuildBot</span>
    </div>
  );
}
