"use client";

// HELEX лого — дууны долгион + HELEX текст + play тэмдэг.
// Вэбийн monochrome (цагаан/цайвар) өнгөнд тааруулсан.
export function Logo() {
  const bars = [9, 16, 22, 14, 19, 11];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        userSelect: "none",
      }}
    >
      {/* долгион + play тэмдэг */}
      <svg
        width="34"
        height="28"
        viewBox="0 0 34 28"
        fill="none"
        aria-hidden="true"
      >
        {bars.map((h, i) => (
          <rect
            key={i}
            x={i * 3.4}
            y={(28 - h) / 2}
            width="2"
            height={h}
            rx="1"
            fill="currentColor"
            opacity={0.5 + i * 0.08}
          />
        ))}
        <polygon points="22,7 33,14 22,21" fill="currentColor" opacity={0.92} />
      </svg>

      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span
          style={{
            fontFamily: "var(--dashboard-font, var(--font-body), system-ui, sans-serif)",
            fontWeight: 700,
            fontSize: 25,
            letterSpacing: "0.14em",
            color: "currentColor",
          }}
        >
          HELE
          <span style={{ color: "currentColor", opacity: 0.75 }}>X</span>
        </span>
      </div>
    </div>
  );
}
