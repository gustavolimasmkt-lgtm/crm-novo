import type { MetadataRoute } from "next";

/** Permite instalar o CRM no celular e no computador (ícone na tela inicial, abre em tela cheia). */
export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.APP_NAME ?? "CRM";
  return {
    name,
    short_name: name.slice(0, 12),
    description: "CRM com WhatsApp e Agente de IA",
    start_url: "/conversas",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
