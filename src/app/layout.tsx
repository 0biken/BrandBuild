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

import Script from "next/script";

export const metadata: Metadata = {
  title: "BrandBuild — Waitlist for Small Business Creator Marketing",
  description: "No minimum spend. No agency fees. Join the waitlist to find creators who drive sales and get matched with brands that pay fairly.",
  openGraph: {
    title: "BrandBuild — Waitlist for Small Business Creator Marketing",
    description: "No minimum spend. No agency fees. Join the waitlist to find creators who drive sales and get matched with brands that pay fairly.",
    url: "https://brandbuild.co",
    siteName: "BrandBuild",
    images: [
      {
        url: "/assets/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "BrandBuild Platform",
      },
    ],
    locale: "en_US",
    type: "website",
  },
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
      <head>
        {/* Placeholder for Plausible/Fathom Analytics */}
        <Script defer data-domain="brandbuild.co" src="https://plausible.io/js/script.js" strategy="afterInteractive" />
        
        {/* Placeholder for Meta Pixel */}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', 'YOUR_PIXEL_ID');
            fbq('track', 'PageView');
          `}
        </Script>
      </head>
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
