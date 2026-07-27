import Image from "next/image";

const networkNodes = [
  { cx: 76, cy: 66, radius: 3.2 },
  { cx: 162, cy: 112, radius: 2.3 },
  { cx: 250, cy: 73, radius: 2.8 },
  { cx: 337, cy: 145, radius: 3.4 },
  { cx: 434, cy: 92, radius: 2.2 },
  { cx: 504, cy: 183, radius: 3.1 },
  { cx: 116, cy: 226, radius: 2.4 },
  { cx: 220, cy: 202, radius: 3.1 },
  { cx: 304, cy: 274, radius: 2.5 },
  { cx: 410, cy: 240, radius: 3.3 },
  { cx: 520, cy: 310, radius: 2.4 },
] as const;

export function AuthSceneArtwork() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden overflow-hidden xl:block">
      <svg className="absolute top-[-5rem] right-[-2rem] h-[58%] w-[66%] text-[#14d36f]" viewBox="0 0 580 380">
        <defs>
          <radialGradient id="auth-map-fade" cx="50%" cy="50%" r="58%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="72%" stopColor="currentColor" stopOpacity="0.025" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <pattern height="13" id="auth-map-dots" patternUnits="userSpaceOnUse" width="13">
            <circle cx="1.5" cy="1.5" fill="currentColor" opacity="0.2" r="1" />
          </pattern>
        </defs>
        <ellipse cx="294" cy="184" fill="url(#auth-map-fade)" rx="274" ry="174" />
        <path
          d="M48 188c62-94 157-148 262-144 92 4 174 50 230 126M46 212c82 66 180 102 285 94 85-7 154-39 207-91M74 66l88 46 88-39 87 72 97-53 70 91M116 226l104-24 84 72 106-34 110 70M162 112l58 90 117-57 73 95M250 73l54 201"
          fill="none"
          opacity="0.2"
          stroke="currentColor"
          strokeDasharray="2 8"
          strokeWidth="1.2"
        />
        <path
          d="M116 102c26-34 62-50 99-39 23 7 38 28 66 31 31 4 54-18 84-19 46-2 89 40 93 86 4 39-21 76-54 94-27 15-59 17-89 12-32-5-62-18-95-17-36 1-69 20-105 14-41-7-74-48-68-89 4-28 24-51 48-67 7-5 14-8 21-12Z"
          fill="url(#auth-map-dots)"
          opacity="0.62"
        />
        {networkNodes.map((node) => (
          <g key={`${node.cx}-${node.cy}`}>
            <circle cx={node.cx} cy={node.cy} fill="currentColor" opacity="0.14" r={node.radius * 3.8} />
            <circle cx={node.cx} cy={node.cy} fill="currentColor" opacity="0.76" r={node.radius} />
          </g>
        ))}
      </svg>
      <Image
        alt=""
        className="absolute right-[-1rem] bottom-[clamp(6.75rem,13vh,8rem)] h-auto w-[clamp(19rem,24vw,29rem)] object-contain drop-shadow-[0_22px_34px_rgba(0,0,0,0.55)]"
        height={747}
        sizes="(min-width: 1920px) 464px, (min-width: 1440px) 24vw, (min-width: 1280px) 24vw, 0px"
        src="/images/auth/whatsapp-commerce-scene.webp"
        width={1215}
      />
    </div>
  );
}
