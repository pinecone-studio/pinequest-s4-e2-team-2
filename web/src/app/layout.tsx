import type { Metadata } from "next";
import { Cormorant, Onest, Caveat, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/_comps/providers/AuthProvider";

// Дизайн репо-гийн фонтууд — зөвхөн .dashboard-* skin эдгээр CSS хувьсагчдыг ашиглана.
const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const cormorant = Cormorant({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HELEX",
  description: "AI-аар монгол хэлнээ орчуулна",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark h-full antialiased ${onest.variable} ${cormorant.variable} ${caveat.variable} ${geistMono.variable}`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-body">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
