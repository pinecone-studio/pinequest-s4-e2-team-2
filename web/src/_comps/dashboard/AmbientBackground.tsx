"use client"

import { useEffect, useRef } from "react"

const FOREIGN = ["A", "R", "文", "学", "语", "字", "ع", "ب", "م", "ر", "अ", "क", "म", "Ω", "Σ", "Δ", "한", "글", "の", "ñ", "ß", "א", "ת"]
const MONG = ["Т", "у", "н", "г", "а", "р", "д", "л", "э", "ө", "ү", "с", "м", "б", "х", "н", "ж", "ы", "ч"]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Гадаад үсгүүд аажмаар Монгол үсэг рүү хувирдаг чимэглэлийн дэвсгэр.
export function AmbientBackground() {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const glyphs: HTMLSpanElement[] = []
    const anims = ["bgDrift", "bgFloat", "bgSwirl"]
    for (let i = 0; i < 56; i++) {
      const span = document.createElement("span")
      const size = 18 + Math.random() * 66
      const terra = Math.random() < 0.3
      const anim = pick(anims)
      span.textContent = pick(FOREIGN)
      span.style.cssText =
        `position:absolute;left:${Math.random() * 100}%;top:${Math.random() * 100}%;` +
        `font-size:${size}px;font-family:var(--font-cormorant),serif;font-weight:500;` +
        `color:rgba(${terra ? "184,104,48" : "237,231,207"},${(0.03 + Math.random() * 0.06).toFixed(3)});` +
        `transform:translate(-50%,-50%);transition:opacity 1.2s ease;will-change:transform;` +
        `animation:${anim} ${(11 + Math.random() * 14).toFixed(1)}s ease-in-out ${(Math.random() * 9).toFixed(1)}s infinite alternate;`
      el.appendChild(span)
      glyphs.push(span)
    }

    const morph = setInterval(() => {
      if (!glyphs.length) return
      const g = pick(glyphs)
      g.style.opacity = "0"
      setTimeout(() => {
        const toMong = Math.random() < 0.72
        g.textContent = pick(toMong ? MONG : FOREIGN)
        g.style.opacity = ""
      }, 1150)
    }, 600)

    return () => {
      clearInterval(morph)
      glyphs.forEach((g) => g.remove())
    }
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}
    />
  )
}
