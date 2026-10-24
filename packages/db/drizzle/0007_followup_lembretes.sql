CREATE TABLE "followup_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"steps" jsonb NOT NULL,
	"window_start" text DEFAULT '08:00' NOT NULL,
	"window_end" text DEFAULT '20:00' NOT NULL,
	"sundays" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminders_sent" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "followup_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_settings" ADD COLUMN "remind_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_settings" ADD COLUMN "remind_hours" jsonb DEFAULT '[24,2]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_settings" ADD COLUMN "remind_template" text;--> statement-breakpoint
ALTER TABLE "followup_settings" ADD CONSTRAINT "followup_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;