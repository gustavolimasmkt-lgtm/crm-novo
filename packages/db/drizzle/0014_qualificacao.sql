ALTER TABLE "capi_events" ADD COLUMN "send_after" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "qualification" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "qualification_reason" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "qualified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "qualified_by" uuid;--> statement-breakpoint
ALTER TABLE "meta_settings" ADD COLUMN "send_qualified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_settings" ADD COLUMN "send_disqualified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_qualified_by_users_id_fk" FOREIGN KEY ("qualified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;