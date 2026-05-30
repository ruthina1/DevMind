import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DevMind — AI Dependency Intelligence",
  description:
    "Proactive AI dependency intelligence. Get a conflict-free, pinned dependency stack before writing a single line of code.",
  keywords: [
    "dependency management",
    "npm",
    "package manager",
    "AI",
    "developer tools",
    "compatibility checker",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
