import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";
import { AppBootstrap } from "@/components/app-bootstrap";
import "./globals.css";

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

export const viewport: Viewport = {
  themeColor: "#00bdb4",
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
      className={`${nunitoSans.variable} h-full bg-[var(--app-bg)] antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-[var(--app-bg)] text-[var(--text-primary)]">
        <AppBootstrap />
        {children}
      </body>
    </html>
  );
}
