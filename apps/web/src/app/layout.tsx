import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW } from "@/components/register-sw";

const appName = process.env.APP_NAME ?? "CRM";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "CRM com WhatsApp e Agente de IA",
  appleWebApp: { capable: true, title: appName, statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/favicon-64.png", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android: o teclado encolhe a tela em vez de cobrir a caixa de mensagem.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
