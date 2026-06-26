"use client";

type ScholarMessageProps = {
  reply: string;
};

export function ScholarMessage({ reply }: ScholarMessageProps) {
  return (
    <div className="dashboard-scholar-message">
      <div className="dashboard-speech-bubble">
        <div className="dashboard-speech-label">Shifu</div>
        <div className="dashboard-speech-text">
          {reply.split(" ").map((word, index) => (
            <span
              key={`${word}-${index}`}
              style={{ animationDelay: `${(0.3 + index * 0.05).toFixed(2)}s` }}
            >
              {word + " "}
            </span>
          ))}
        </div>
        <div className="dashboard-speech-tail" />
      </div>
    </div>
  );
}
