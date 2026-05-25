import type { Metadata } from "next";
import { Syne, DM_Sans } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

export const metadata: Metadata = {
  title: "BrandBuild — Social Media Management for Ambitious Brands",
  description: "Unforgettable campaigns start with insight. Built for brands, designed for results. Join the waitlist.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-body bg-white text-brand-black">
        <div className="grain-overlay" />
        <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
          <defs>
            <clipPath id="cutout-clip" clipPathUnits="objectBoundingBox">
              <path d="M 0,0.08 Q 0,0 0.08,0 L 0.52,0 Q 0.6,0 0.6,0.08 L 0.6,0.32 Q 0.6,0.4 0.68,0.4 L 0.92,0.4 Q 1.0,0.4 1.0,0.48 L 1.0,0.92 Q 1.0,1.0 0.92,1.0 L 0.08,1.0 Q 0,1.0 0,0.92 Z" />
            </clipPath>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
