const sceneDescription = "AgentWhatsApp AI assistant turning a customer conversation into a confirmed order";

const orderRows = ["Customer", "Product", "Delivery"] as const;

export function AuthAgentAnimationFallback() {
  return (
    <div aria-label={sceneDescription} className="relative aspect-[36/23] w-full" role="img">
      <svg aria-hidden="true" className="block size-full overflow-visible" focusable="false" preserveAspectRatio="xMidYMid meet" viewBox="0 0 720 430">
        <ellipse cx="369" cy="244" fill="#dff1e4" opacity="0.65" rx="275" ry="178" />
        <ellipse cx="343" cy="393" fill="#52645a" opacity="0.16" rx="103" ry="12" />

        <rect fill="#ffffff" height="58" rx="15" stroke="#d9e8dd" strokeWidth="1.5" width="190" x="34" y="76" />
        <path d="M68 132 57 145 81 134" fill="#ffffff" stroke="#d9e8dd" strokeLinejoin="round" strokeWidth="1.5" />
        <circle cx="61" cy="104" fill="#dcefe2" r="12" />
        <text fill="#3d6950" fontFamily="var(--font-geist-sans), sans-serif" fontSize="11" fontWeight="700" x="57.5" y="108">
          C
        </text>
        <text fill="#2d4736" fontFamily="var(--font-geist-sans), sans-serif" fontSize="11.5" fontWeight="600" x="82" y="101">
          Customer
        </text>
        <text fill="#617266" fontFamily="var(--font-geist-sans), sans-serif" fontSize="10.5" x="82" y="118">
          Two delivery slots, please.
        </text>

        <path d="M340 99V82" fill="none" stroke="#809087" strokeLinecap="round" strokeWidth="4" />
        <rect fill="#6cae7d" height="13" rx="6.5" width="13" x="333.5" y="68" />
        <rect fill="#b7c3bb" height="42" rx="18" width="26" x="236" y="137" />
        <rect fill="#b7c3bb" height="42" rx="18" width="26" x="419" y="137" />
        <rect fill="#edf1ee" height="111" rx="38" stroke="#b5c0b8" strokeWidth="2" width="170" x="255" y="96" />
        <path d="M280 122c30-15 88-16 119 1" fill="none" opacity="0.72" stroke="#ffffff" strokeLinecap="round" strokeWidth="7" />
        <rect fill="#142219" height="69" rx="23" stroke="#62746a" strokeWidth="1.5" width="126" x="277" y="126" />
        <rect fill="#a6efb7" height="6" rx="3" width="24" x="300" y="155" />
        <rect fill="#a6efb7" height="6" rx="3" width="24" x="356" y="155" />
        <rect fill="#77c38b" height="3" rx="1.5" width="64" x="308" y="180" />
        <rect fill="#7c8f84" height="20" rx="8" width="30" x="325" y="204" />
        <path d="M296 247c14-17 77-17 95 0l14 86c3 20-11 37-31 37h-61c-20 0-34-17-31-37Z" fill="#edf1ee" stroke="#acb9b0" strokeWidth="2" />
        <path d="M307 336c18 8 51 8 69 0l3 17c-18 10-54 10-75 0Z" fill="#1d3d2b" />
        <rect fill="#4d9562" height="28" rx="8" width="42" x="319" y="279" />
        <path d="M331 293h18m-9-7 8 7-8 7" fill="none" stroke="#effff3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
        <path d="M294 262c-31 4-50 27-51 57" fill="none" stroke="#9eaca3" strokeLinecap="round" strokeWidth="18" />
        <circle cx="240" cy="322" fill="#edf1ee" r="13" stroke="#9eaca3" strokeWidth="1.5" />
        <path d="M392 261c28 5 46 26 48 53" fill="none" stroke="#9eaca3" strokeLinecap="round" strokeWidth="18" />
        <circle cx="444" cy="316" fill="#edf1ee" r="13" stroke="#9eaca3" strokeWidth="1.5" />

        <rect fill="#7f9989" height="190" opacity="0.12" rx="17" width="202" x="490" y="139" />
        <rect fill="#ffffff" height="190" rx="17" stroke="#d1e0d5" strokeWidth="1.5" width="202" x="483" y="132" />
        <circle cx="508" cy="157" fill="#e1f2e5" r="11" />
        <path d="M503 157 507 161 514 153" fill="none" stroke="#39734d" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.25" />
        <text fill="#24402f" fontFamily="var(--font-geist-sans), sans-serif" fontSize="13" fontWeight="700" x="526" y="161">
          Order details
        </text>
        <line stroke="#e4ece6" x1="501" x2="666" y1="178" y2="178" />
        {orderRows.map((label, index) => {
          const rowY = 198 + index * 34;

          return (
            <g key={label}>
              <circle cx="508" cy={rowY + 4} fill="#edf5ef" r="8" />
              <rect fill="#86a38f" height="7" opacity="0.75" rx="2" width="7" x="504.5" y={rowY + 0.5} />
              <text fill="#2d4736" fontFamily="var(--font-geist-sans), sans-serif" fontSize="10.5" fontWeight="650" x="524" y={rowY + 1}>
                {label}
              </text>
              <circle cx="659" cy={rowY + 4} fill="#e3f3e7" r="9" />
              <path d={`M654 ${rowY + 4}l3 3 6-7`} fill="none" stroke="#34764a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
            </g>
          );
        })}
        <rect fill="#315f43" height="32" rx="11" width="153" x="507" y="277" />
        <circle cx="525" cy="293" fill="#8ed0a2" r="8" />
        <path d="M521 293 524 296 530 289" fill="none" stroke="#173d26" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
        <text fill="#f6fff8" fontFamily="var(--font-geist-sans), sans-serif" fontSize="10.5" fontWeight="700" x="540" y="297">
          Order confirmed
        </text>
      </svg>
    </div>
  );
}
