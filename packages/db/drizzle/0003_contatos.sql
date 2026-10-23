ALTER TABLE "contacts" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Contatos existentes vieram do WhatsApp (mensagens ou checagem do número).
UPDATE "contacts" SET "wa_verified" = true;
