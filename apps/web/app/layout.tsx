/**
 * @fileoverview Root Layout for the 'The Architect' Web Application.
 *
 * Problem: Every page in our app needs the same fonts, styles,
 * and metadata (like the browser tab title).
 *
 * Solution: Next.js 'Layout' component. This wraps all our pages,
 * ensuring a consistent look and feel across the entire site.
 */

import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import type { ReactNode } from "react";
import "./site.css";

// Configure high-quality fonts for a professional "SaaS" feel
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

/**
 * Metadata defines what appears in the browser tab and social media previews.
 */
export const metadata: Metadata = {
  title: "The Architect",
  description: "Voice-first AI technical cofounder"
};

/**
 * The RootLayout component wraps every page in the 'app' directory.
 */
export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      {/*
        We apply our custom font variables to the body so they can
        be used throughout our CSS files.
      */}
      <body className={`${headingFont.variable} ${bodyFont.variable}`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
