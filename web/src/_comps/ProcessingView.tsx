"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

const STEPS = [
  { id: "fetch",      label: "Видео татаж байна",             sublabel: "YouTube-с видео мэдээлэл авч байна...",      duration: 2000 },
  { id: "transcribe", label: "Текст болгон хөрвүүлж байна",   sublabel: "Яриаг тэмдэглэж байна (Whisper AI)...",      duration: 3500 },
  { id: "translate",  label: "Монгол руу орчуулж байна",       sublabel: "Хэсэг тус бүрийг GPT-4 орчуулж байна...",   duration: 4000 },
  { id: "polish",     label: "Хэлийг засаж сайжруулж байна",  sublabel: "Монгол хэлний дүрмийг шалгаж байна...",     duration: 2500 },
  { id: "tts",        label: "Дуу хоолой нэмж байна",          sublabel: "AI дуу хоолойгоор хэлүүлж байна...",        duration: 3000 },
  { id: "sync",       label: "Видеотой синхрончилж байна",    sublabel: "Дуу болон текстийг цагтай тааруулж байна...", duration: 2000 },
];

export default function ProcessingView({
  videoUrl,
  onComplete,
}: {
  videoUrl: string;
  onComplete: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set<number>());
  const [stepProgress, setStepProgress] = useState(0);

  const totalDuration = STEPS.reduce((acc, s) => acc + s.duration, 0);
  const completedDuration = STEPS.slice(0, currentStep).reduce((acc, s) => acc + s.duration, 0);
  const overallProgress = Math.min(
    100,
    Math.round(
      ((completedDuration + (stepProgress / 100) * (STEPS[currentStep]?.duration ?? 0)) /
        totalDuration) *
        100
    )
  );

  useEffect(() => {
    let stepTimer: ReturnType<typeof setTimeout>;
    let progressInterval: ReturnType<typeof setInterval>;

    const runStep = (stepIdx: number) => {
      if (stepIdx >= STEPS.length) {
        onComplete();
        return;
      }

      setCurrentStep(stepIdx);
      setStepProgress(0);

      const step = STEPS[stepIdx];
      const intervalMs = 50;
      const increment = (intervalMs / step.duration) * 100;

      progressInterval = setInterval(() => {
        setStepProgress((prev) => {
          const next = prev + increment;
          if (next >= 100) {
            clearInterval(progressInterval);
            return 100;
          }
          return next;
        });
      }, intervalMs);

      stepTimer = setTimeout(() => {
        clearInterval(progressInterval);
        setStepProgress(100);
        setCompletedSteps((prev) => new Set([...prev, stepIdx]));
        setTimeout(() => runStep(stepIdx + 1), 300);
      }, step.duration);
    };

    runStep(0);

    return () => {
      clearTimeout(stepTimer);
      clearInterval(progressInterval);
    };
  }, [onComplete]);

  const videoId = videoUrl.match(/(?:v=|youtu\.be\/)([^&\s]+)/)?.[1];

  return (
    <div className="w-full max-w-xl mx-auto px-4">
      <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border mb-6">
        {videoId ? (
          <img
            src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
            alt="Video thumbnail"
            className="w-20 h-14 object-cover rounded-lg flex-shrink-0"
          />
        ) : (
          <div className="w-20 h-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground mb-0.5">Боловсруулж байна</p>
          <p className="text-sm font-medium text-foreground truncate">{videoUrl}</p>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-semibold text-foreground">Нийт явц</span>
          <span className="text-sm font-bold text-primary">{overallProgress}%</span>
        </div>
        <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-100 ease-linear"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {STEPS.map((step, idx) => {
          const isDone = completedSteps.has(idx);
          const isActive = idx === currentStep && !isDone;
          const isPending = idx > currentStep;

          return (
            <div
              key={step.id}
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all duration-300 ${
                isActive
                  ? "border-primary/40 bg-primary/5"
                  : isDone
                  ? "border-border bg-card opacity-70"
                  : "border-border bg-card opacity-40"
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {isDone ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : isActive ? (
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                  {step.label}
                </p>
                {isActive && (
                  <p className="text-xs text-muted-foreground mt-0.5">{step.sublabel}</p>
                )}
                {isActive && (
                  <div className="mt-2 w-full h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-100 ease-linear"
                      style={{ width: `${stepProgress}%` }}
                    />
                  </div>
                )}
              </div>
              {isDone && (
                <span className="text-xs text-green-500 font-medium flex-shrink-0">Дууссан</span>
              )}
              {isPending && (
                <span className="text-xs text-muted-foreground/50 font-medium flex-shrink-0">Хүлээж байна</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
