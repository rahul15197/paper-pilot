import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaperPilot — Understand Any Document Instantly",
  description: "PaperPilot uses Google Gemini AI to decode confusing government notices, tax forms, legal letters, and any official document into plain-language actions. Works with voice for elderly users.",
  keywords: ["document assistant", "AI document reader", "government notice help", "Gemini AI", "legal document translator"],
  openGraph: {
    title: "PaperPilot — Understand Any Document Instantly",
    description: "Decode any confusing document with AI. Just photograph it and ask.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
