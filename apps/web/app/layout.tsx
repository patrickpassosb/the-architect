import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const headingFont = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-heading"
});

const bodyFont = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "The Architect",
  description: "Voice-first AI technical cofounder"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${bodyFont.variable}`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
