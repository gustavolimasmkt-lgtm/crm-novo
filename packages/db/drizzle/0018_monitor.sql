ALTER TABLE "whatsapp_connections" ADD COLUMN "down_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD COLUMN "down_alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD COLUMN "check_failed_since" timestamp with time zone;