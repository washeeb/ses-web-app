import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://synclyticsenterprisesystems.com"),
  title: { default: "Synclytics Enterprise Systems", template: "%s · Synclytics Enterprise Systems" },
  description: "Enterprise software, integration, infrastructure, networks, security, hardware and data solutions for businesses and institutions in Ghana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH">
      <body className="min-h-screen font-sans antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
