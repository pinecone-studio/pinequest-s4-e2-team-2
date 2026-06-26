"use client"

// "Ask" дарахад гарч ирэх хөнгөн робот туслах (хүний зургийн оронд inline SVG).
export function ScholarPortrait() {
  return (
    <div className="dashboard-scholar-portrait">
      <div>
        <svg viewBox="0 0 260 340" fill="none" role="img" aria-label="AI туслах робот">
          <defs>
            <linearGradient id="bot-body" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f6f0d8" />
              <stop offset="100%" stopColor="#cdc6ac" />
            </linearGradient>
            <radialGradient id="bot-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#9fe6c4" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#9fe6c4" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* зөөлөн гэрэлтэлт */}
          <ellipse cx="130" cy="150" rx="120" ry="140" fill="url(#bot-glow)" />

          {/* антен */}
          <line x1="130" y1="58" x2="130" y2="30" stroke="#cdc6ac" strokeWidth="4" strokeLinecap="round" />
          <circle cx="130" cy="24" r="8" fill="#cf9f6b">
            <animate attributeName="opacity" values="1;0.4;1" dur="2.2s" repeatCount="indefinite" />
          </circle>

          {/* толгой */}
          <rect x="58" y="58" width="144" height="118" rx="34" fill="url(#bot-body)" stroke="#b9b297" strokeWidth="2" />
          {/* нүүрний дэлгэц */}
          <rect x="74" y="74" width="112" height="86" rx="22" fill="#0c1413" />
          {/* нүд */}
          <circle cx="106" cy="116" r="11" fill="#9fe6c4">
            <animate attributeName="r" values="11;3;11" dur="4.5s" repeatCount="indefinite" />
          </circle>
          <circle cx="154" cy="116" r="11" fill="#9fe6c4">
            <animate attributeName="r" values="11;3;11" dur="4.5s" repeatCount="indefinite" />
          </circle>
          {/* инээмсэглэл */}
          <path d="M108 138 Q130 150 152 138" stroke="#cf9f6b" strokeWidth="4" strokeLinecap="round" fill="none" />

          {/* хүзүү */}
          <rect x="118" y="176" width="24" height="16" fill="#cdc6ac" />

          {/* бие */}
          <path d="M70 196 Q130 182 190 196 L196 300 Q130 318 64 300 Z" fill="url(#bot-body)" stroke="#b9b297" strokeWidth="2" />
          {/* цээжний цөм */}
          <circle cx="130" cy="244" r="20" fill="#0c1413" />
          <circle cx="130" cy="244" r="9" fill="#cf9f6b">
            <animate attributeName="opacity" values="1;0.5;1" dur="2.6s" repeatCount="indefinite" />
          </circle>

          {/* гар */}
          <rect x="44" y="206" width="20" height="64" rx="10" fill="#cdc6ac" />
          <rect x="196" y="206" width="20" height="64" rx="10" fill="#cdc6ac" />
        </svg>
      </div>
    </div>
  )
}
