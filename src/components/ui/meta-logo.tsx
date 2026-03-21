import { useId } from 'react';

interface MetaLogoProps {
  className?: string;
}

/**
 * Official Meta logo SVG with gradient infinity-M shape.
 * Uses React's useId to generate unique gradient IDs, preventing conflicts
 * when multiple instances appear on the same page.
 */
export function MetaLogo({ className }: MetaLogoProps) {
  const uid = useId().replace(/:/g, '');

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      aria-label="Meta"
      role="img"
    >
      <path
        fill={`url(#${uid}a)`}
        d="M6.897 4h-.024l-.031 2.615h.022c1.715 0 3.046 1.357 5.94 6.246.508.859 1.68 2.98 1.68 2.98l1.376-2.387S14.207 11.4 13.72 10.59C11.312 6.49 9.397 4 6.897 4"
      />
      <path
        fill={`url(#${uid}b)`}
        d="M17.59 4.17c-1.929 0-3.625 1.605-5.116 4.085l1.394 2.352c1.19-2.11 2.418-3.314 3.629-3.314 1.446 0 2.574 1.353 2.574 3.04 0 .97-.365 1.887-.957 2.557l1.97 2.286C22.046 13.835 23 12.11 23 10.333 23 6.865 20.612 4.17 17.59 4.17"
      />
      <path
        fill={`url(#${uid}c)`}
        d="M6.893 6.615c-2.56 0-5.89 2.673-5.89 8.03C1.003 18.38 3.3 20 5.442 20c1.923 0 3.574-.985 5.303-3.527l-1.49-2.19C7.87 16.172 6.88 17.22 5.584 17.22c-1.287 0-2.178-1.13-2.178-2.83 0-3.64 1.757-5.4 3.487-5.4.254 0 .503.04.747.113z"
      />
      <path
        fill="#0082fb"
        d="M15.354 16.946c-1.016 1.1-1.976 1.693-3.083 1.693-.774 0-1.485-.299-2.124-.882l-1.49 2.185C9.716 20.618 10.98 21 12.271 21c2.006 0 3.714-.858 5.271-2.73z"
      />
      <path
        fill={`url(#${uid}d)`}
        d="M12.271 18.639c-.774 0-1.485-.299-2.124-.882l-1.49 2.185C9.716 20.618 10.98 21 12.271 21c2.006 0 3.714-.858 5.271-2.73l-1.188-1.324c-1.016 1.1-1.976 1.693-3.083 1.693"
      />
      <path
        fill={`url(#${uid}e)`}
        d="M6.897 4h-.024l-.031 2.615h.022c.904 0 1.761.38 2.602 1.051l.748-2.58C9.354 4.413 8.168 4 6.897 4"
      />
      <path
        fill={`url(#${uid}f)`}
        d="M20.084 15.175c-.6.67-1.263 1.144-1.97 1.353l1.286 1.416C20.73 17.02 21.7 15.81 22.165 14.4z"
      />
      <path
        fill={`url(#${uid}g)`}
        d="M3.406 14.785c-.002.268.014.532.046.79L1.003 12.64v2.004c0 .047.001.093.002.14z"
      />
      <path
        fill={`url(#${uid}h)`}
        d="m8.147 5.086-.748 2.58c.528.414 1.059.97 1.588 1.68l1.395-2.352c-.496-.74-1.008-1.37-1.535-1.81z"
      />
      <path
        fill={`url(#${uid}i)`}
        d="M20.084 15.175 22.165 14.4a8.4 8.4 0 0 0 .362-1.224l-2.484-2.182a6.8 6.8 0 0 1-.957 2.557z"
      />
      <path
        fill={`url(#${uid}j)`}
        d="M3.406 14.785 1.05 12.78a9.3 9.3 0 0 0 .273 2.462l1.77 2.085a5.4 5.4 0 0 1-.687-2.542"
      />
      <path
        fill={`url(#${uid}k)`}
        d="m10.38 13.283-1.49-2.19c-.467.638-.94 1.4-1.418 2.299l1.676 2.39q.662-1.28 1.232-2.499"
      />
      <path
        fill={`url(#${uid}l)`}
        d="m9.148 15.782 1.676 2.39a11 11 0 0 1-.528.851L8.805 17.04c.118-.417.23-.844.343-1.258"
      />
      <path
        fill={`url(#${uid}m)`}
        d="M3.406 14.785c.03 1.145.4 2.084 1.094 2.742l1.77 2.085C5.104 18.97 4.1 17.92 3.68 16.527z"
      />
      <defs>
        <linearGradient
          id={`${uid}a`}
          x1="9.128"
          x2="9.128"
          y1="4"
          y2="15.821"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0064e1" />
          <stop offset=".4" stopColor="#0064e1" />
          <stop offset=".83" stopColor="#0073ee" />
          <stop offset="1" stopColor="#0082fb" />
        </linearGradient>
        <linearGradient
          id={`${uid}b`}
          x1="18.033"
          x2="18.033"
          y1="4.17"
          y2="15.222"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0082fb" />
          <stop offset="1" stopColor="#0064e0" />
        </linearGradient>
        <linearGradient
          id={`${uid}c`}
          x1="5.765"
          x2="5.765"
          y1="6.615"
          y2="20"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0082fb" />
          <stop offset="1" stopColor="#0064e0" />
        </linearGradient>
        <linearGradient
          id={`${uid}d`}
          x1="13.192"
          x2="13.192"
          y1="17.757"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0082fb" />
          <stop offset="1" stopColor="#0064e0" />
        </linearGradient>
        <linearGradient
          id={`${uid}e`}
          x1="7.693"
          x2="7.693"
          y1="4"
          y2="7.086"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0064e1" />
          <stop offset="1" stopColor="#0064e1" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={`${uid}f`}
          x1="20.45"
          x2="20.45"
          y1="15.175"
          y2="17.944"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0064e1" stopOpacity="0" />
          <stop offset=".13" stopColor="#0064e1" stopOpacity=".05" />
          <stop offset="1" stopColor="#0064e1" stopOpacity=".4" />
        </linearGradient>
        <linearGradient
          id={`${uid}g`}
          x1="2.204"
          x2="2.204"
          y1="12.64"
          y2="15.575"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0082fb" stopOpacity="0" />
          <stop offset="1" stopColor="#0082fb" stopOpacity=".5" />
        </linearGradient>
        <linearGradient
          id={`${uid}h`}
          x1="9.515"
          x2="9.515"
          y1="5.086"
          y2="9.346"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0064e1" />
          <stop offset="1" stopColor="#0064e1" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={`${uid}i`}
          x1="21.264"
          x2="21.264"
          y1="10.994"
          y2="15.175"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0064e1" stopOpacity="0" />
          <stop offset="1" stopColor="#0064e1" stopOpacity=".4" />
        </linearGradient>
        <linearGradient
          id={`${uid}j`}
          x1="2.228"
          x2="2.228"
          y1="12.78"
          y2="17.327"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0082fb" stopOpacity="0" />
          <stop offset="1" stopColor="#0082fb" stopOpacity=".5" />
        </linearGradient>
        <linearGradient
          id={`${uid}k`}
          x1="9.636"
          x2="9.636"
          y1="11.093"
          y2="15.782"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0082fb" stopOpacity="0" />
          <stop offset="1" stopColor="#0082fb" stopOpacity=".5" />
        </linearGradient>
        <linearGradient
          id={`${uid}l`}
          x1="9.888"
          x2="9.888"
          y1="15.782"
          y2="19.023"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0082fb" stopOpacity=".5" />
          <stop offset="1" stopColor="#0082fb" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={`${uid}m`}
          x1="4.55"
          x2="4.55"
          y1="14.785"
          y2="19.612"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0082fb" stopOpacity=".5" />
          <stop offset="1" stopColor="#0082fb" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
