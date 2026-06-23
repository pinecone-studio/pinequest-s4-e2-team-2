import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MonCast",
  description: "AI-аар монгол хэлнээ орчуулна",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground font-body">
        {children}
      </body>
    </html>
  );
}
