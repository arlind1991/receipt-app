import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { AppBootstrap } from "@/components/app-bootstrap";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const viewport: Viewport = {
  themeColor: "#08111f",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export const metadata: Metadata = {
  title: "SnapReceipt",
  description: "A camera-first PWA for capturing and storing receipts.",
  applicationName: "SnapReceipt",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SnapReceipt",
  },
  formatDetection: {
    telephone: false,
  },
  manifest: "/manifest.webmanifest",
  icons: {
    apple: "/apple-touch-icon.svg",
    icon: [
      { url: "/icon-192.svg", type: "image/svg+xml", sizes: "192x192" },
      { url: "/icon-512.svg", type: "image/svg+xml", sizes: "512x512" },
    ],
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
      className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} h-full bg-[var(--app-bg)] antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-[var(--app-bg)] text-[var(--text-primary)]">
        <AppBootstrap />
        {children}
      </body>
    </html>
  );
}
