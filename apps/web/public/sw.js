// Service worker mínimo: permite instalar o CRM como app. Não guarda nada em cache
// (o CRM precisa estar sempre atualizado), então não interfere nas telas.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
