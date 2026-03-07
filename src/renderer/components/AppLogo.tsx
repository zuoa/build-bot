import { useId } from 'react';

interface AppLogoProps {
  compact?: boolean;
}

export default function AppLogo({ compact = false }: AppLogoProps): JSX.Element {
  const gradientId = useId();
  const panelId = useId();
  const glowId = useId();

  return (
    <div className={`app-logo ${compact ? 'is-compact' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 80 80" role="img">
        <defs>
          <linearGradient id={gradientId} x1="12" y1="8" x2="67" y2="70" gradientUnits="userSpaceOnUse">
            <stop stopColor="#C96B3D" />
            <stop offset="0.52" stopColor="#8F4B31" />
            <stop offset="1" stopColor="#183B42" />
          </linearGradient>
          <linearGradient id={panelId} x1="23" y1="15" x2="58" y2="61" gradientUnits="userSpaceOnUse">
            <stop stopColor="#223841" />
            <stop offset="1" stopColor="#11262C" />
          </linearGradient>
          <radialGradient
            id={glowId}
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(40 35) rotate(90) scale(28)"
          >
            <stop stopColor="#E18A57" stopOpacity="0.68" />
            <stop offset="1" stopColor="#E18A57" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="6" y="6" width="68" height="68" rx="19" fill={`url(#${gradientId})`} />
        <rect x="7.5" y="7.5" width="65" height="65" rx="18" stroke="rgba(245,239,228,0.2)" />
        <rect x="14.5" y="14.5" width="51" height="51" rx="14" fill={`url(#${panelId})`} />
        <circle cx="40" cy="36" r="26" fill={`url(#${glowId})`} />

        <g fill="#F5EFE4">
          <rect x="25" y="19" width="7" height="5.5" rx="2" />
          <rect x="36.5" y="16.5" width="7" height="8" rx="2" />
          <rect x="48" y="19" width="7" height="5.5" rx="2" />

          <rect x="22" y="26" width="36" height="24" rx="8" />
          <rect x="33" y="46.5" width="14" height="13.5" rx="4" />
          <rect x="26.5" y="31" width="8.5" height="8.5" rx="2.8" fill="#183B42" />
          <rect x="45" y="31" width="8.5" height="8.5" rx="2.8" fill="#183B42" />
          <rect x="29.2" y="33.8" width="3.2" height="3.2" rx="1" fill="#C96B3D" />
          <rect x="47.7" y="33.8" width="3.2" height="3.2" rx="1" fill="#C96B3D" />
        </g>

        <path
          d="M30 44.6c2.8 2.4 6.1 3.6 10 3.6s7.2-1.2 10-3.6"
          fill="none"
          stroke="#183B42"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>BuildBot</span>
    </div>
  );
}
