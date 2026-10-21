import type { Metadata, Viewport } from "next";
import "./globals.css";

const appName = process.env.APP_NAME ?? "CRM";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "CRM com WhatsApp e Agente de IA",
  appleWebApp: { capable: true, title: appName, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
