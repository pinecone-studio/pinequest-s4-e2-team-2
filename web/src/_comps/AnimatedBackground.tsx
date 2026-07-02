"use client";

import { useEffect, useRef, useState } from "react";
import { useVideoProcess } from "@/_comps/providers/VideoProcessProvider";
const LANGUAGES = [
  { label: "English", native: "English" },
  { label: "Deutsch", native: "Deutsch" },
  { label: "Russian", native: "Русский" },
  { label: "Chinese", native: "中文" },
  { label: "Japanese", native: "日本語" },
  { label: "Mongolian", native: "Монгол" },
];

const TEXT_ROWS = [
  {
    text: "English  Deutsch  Русский  中文  日本語  Монгол  English  Deutsch  Русский  中文  日本語  Монгол",
    dir: 1,
    speed: 28,
    size: "text-[96px]",
    opacity: "opacity-[0.04]",
    top: "8%",
  },
  {
    text: "中文  日本語  Монгол  English  Deutsch  Русский  中文  日本語  Монгол  English  Deutsch  Русский",
    dir: -1,
    speed: 22,
    size: "text-[80px]",
    opacity: "opacity-[0.05]",
    top: "22%",
  },
  {
    text: "Русский  中文  English  日本語  Deutsch  Монгол  Русский  中文  English  日本語  Deutsch  Монгол",
    dir: 1,
    speed: 35,
    size: "text-[112px]",
    opacity: "opacity-[0.03]",
    top: "38%",
  },
  {
    text: "Монгол  Deutsch  日本語  Русский  中文  English  Монгол  Deutsch  日本語  Русский  中文  English",
    dir: -1,
    speed: 20,
    size: "text-[88px]",
    opacity: "opacity-[0.05]",
    top: "55%",
  },
  {
    text: "English  日本語  Монгол  Русский  Deutsch  中文  English  日本語  Монгол  Русский  Deutsch  中文",
    dir: 1,
    speed: 30,
    size: "text-[100px]",
    opacity: "opacity-[0.04]",
    top: "70%",
  },
  {
    text: "Deutsch  Монгол  中文  English  Русский  日本語  Deutsch  Монгол  中文  English  Русский  日本語",
    dir: -1,
    speed: 25,
    size: "text-[72px]",
    opacity: "opacity-[0.06]",
    top: "85%",
  },
];

function GlobeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const { videoAction } = useVideoProcess();
  const searching = videoAction === "searching";

  // Rotation speed target: slow idle spin, fast while searching. A ref lets the
  // RAF loop read the latest target each frame WITHOUT being torn down/recreated
  // on state change (which would reset the globe).
  const targetSpeedRef = useRef(0.003);
  useEffect(() => {
    targetSpeedRef.current = searching ? 0.02 : 0.003;
  }, [searching]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let angle = 0;
    let speed = targetSpeedRef.current; // current speed, eased toward the target
    let running = true;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      if (!running) return;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.42;

      const glow = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 1.2);
      glow.addColorStop(0, "rgba(120,160,255,0.06)");
      glow.addColorStop(0.5, "rgba(80,120,220,0.04)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.2, 0, Math.PI * 2);
      ctx.fill();

      const grad = ctx.createRadialGradient(
        cx - R * 0.25,
        cy - R * 0.2,
        R * 0.1,
        cx,
        cy,
        R,
      );
      grad.addColorStop(0, "rgba(80,110,200,0.14)");
      grad.addColorStop(0.5, "rgba(40,70,160,0.09)");
      grad.addColorStop(1, "rgba(10,20,80,0.04)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(100,140,255,0.18)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      const latLines = 9;
      ctx.strokeStyle = "rgba(100,150,255,0.10)";
      ctx.lineWidth = 0.8;
      for (let i = 1; i < latLines; i++) {
        const lat = (i / latLines) * Math.PI - Math.PI / 2;
        const r = R * Math.cos(lat);
        const y = cy + R * Math.sin(lat);
        if (r > 0) {
          ctx.beginPath();
          ctx.ellipse(cx, y, r, r * 0.18, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const lonLines = 12;
      for (let i = 0; i < lonLines; i++) {
        const lon = (i / lonLines) * Math.PI + angle;
        const rx = R * Math.abs(Math.cos(lon));
        const skew = Math.sin(lon) * 0.12;
        const alpha = 0.06 + 0.06 * Math.abs(Math.cos(lon));
        ctx.strokeStyle = `rgba(120,160,255,${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(
          cx + R * Math.sin(lon) * 0.05,
          cy,
          rx,
          R,
          skew,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }

      const shine = ctx.createRadialGradient(
        cx - R * 0.3,
        cy - R * 0.35,
        0,
        cx - R * 0.1,
        cy - R * 0.1,
        R * 0.6,
      );
      shine.addColorStop(0, "rgba(200,220,255,0.10)");
      shine.addColorStop(1, "rgba(200,220,255,0)");
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // Ease current speed toward the target for a smooth accelerate/decelerate.
      speed += (targetSpeedRef.current - speed) * 0.05;
      angle += speed;
      frameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: "block" }}
    />
  );
}

function TextRow({
  text,
  dir,
  speed,
  size,
  opacity,
  top,
}: {
  text: string;
  dir: number;
  speed: number;
  size: string;
  opacity: string;
  top: string;
}) {
  const [offset, setOffset] = useState(0);
  const frameRef = useRef(0);
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    const step = (ts: number) => {
      if (lastRef.current === null) lastRef.current = ts;
      const dt = ts - lastRef.current;
      lastRef.current = ts;
      setOffset((prev) => {
        const next = prev + dir * (speed / 1000) * dt;
        const wrap = 3000;
        if (next > wrap) return next - wrap;
        if (next < -wrap) return next + wrap;
        return next;
      });
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [dir, speed]);

  return (
    <div
      className={`absolute whitespace-nowrap font-heading font-black select-none pointer-events-none ${size} ${opacity}`}
      style={{
        top,
        transform: `translateX(${offset}px)`,
        left: 0,
        color: "currentColor",
      }}
    >
      {text}&nbsp;&nbsp;&nbsp;{text}
    </div>
  );
}

function LanguageCycler() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const cycle = () => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % LANGUAGES.length);
        setVisible(true);
      }, 700);
    };
    const timer = setInterval(cycle, 2800);
    return () => clearInterval(timer);
  }, []);

  const lang = LANGUAGES[idx];

  return (
    <div className="flex flex-col items-center gap-1 mb-10">
      <div
        className="text-sm font-medium tracking-widest uppercase text-primary/60 transition-all duration-500"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(-8px)",
        }}
      >
        {lang.label}
      </div>
      <div
        className="text-5xl sm:text-7xl font-black font-heading text-foreground/90 transition-all duration-500"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible
            ? "translateY(0) scale(1)"
            : "translateY(12px) scale(0.96)",
        }}
      >
        {lang.native}
      </div>
    </div>
  );
}

export default function AnimatedBackground() {
  // Reacts to the shared search state: when the user is searching, the globe
  // spins faster (see GlobeCanvas) and the language texts fade out and unmount
  // from paint (display:none) so they don't compete with the results.
  const { videoAction } = useVideoProcess();
  const searching = videoAction === "searching";

  // Fade the texts (opacity → 0), THEN flip to display:none once the fade has
  // finished. Coming back, show them first so they can fade in again.
  const [textsGone, setTextsGone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTextsGone(searching), searching ? 500 : 0); // match duration-500
    return () => clearTimeout(timer);
  }, [searching]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[min(100vw,700px)] h-[min(100vw,700px)] opacity-80 absolute top-1/4">
          <GlobeCanvas />
        </div>
      </div>

      <div
        className={`absolute inset-0 text-foreground overflow-hidden transition-opacity duration-500 ${
          searching ? "opacity-0" : "opacity-100"
        }`}
        style={{ display: textsGone ? "none" : undefined }}
      >
        {TEXT_ROWS.map((row, i) => (
          <TextRow key={i} {...row} />
        ))}
      </div>

      <div
        className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-blue-500/5 blur-[120px] animate-pulse"
        style={{ animationDuration: "8s" }}
      />
      <div
        className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-indigo-500/5 blur-[100px] animate-pulse"
        style={{ animationDuration: "12s", animationDelay: "3s" }}
      />
      <div
        className="absolute top-1/2 right-1/3 w-[300px] h-[300px] rounded-full bg-cyan-500/4 blur-[90px] animate-pulse"
        style={{ animationDuration: "10s", animationDelay: "6s" }}
      />

      <div
        className={`absolute inset-0 flex flex-col gap-10 items-center justify-center pb-48 transition-opacity duration-500 ${
          searching ? "opacity-0" : "opacity-100"
        }`}
        style={{ display: textsGone ? "none" : undefined }}
      >
        <LanguageCycler />
      </div>
    </div>
  );
}
