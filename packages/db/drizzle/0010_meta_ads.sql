CREATE TYPE "public"."capi_event_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "capi_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"status" "capi_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_ads" (
	"organization_id" uuid NOT NULL,
	"ad_id" text NOT NULL,
	"name" text,
	"adset_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_ads_organization_id_ad_id_pk" PRIMARY KEY("organization_id","ad_id")
);
--> statement-breakpoint
CREATE TABLE "meta_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"capi_enabled" boolean DEFAULT false NOT NULL,
	"capi_enabled_at" timestamp with time zone,
	"dataset_id" text,
	"capi_token_enc" text,
	"test_event_code" text,
	"waba_id" text,
	"send_lead" boolean DEFAULT true NOT NULL,
	"send_schedule" boolean DEFAULT true NOT NULL,
	"send_purchase" boolean DEFAULT true NOT NULL,
	"ad_account_id" text,
	"ads_token_enc" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "ad_id" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "ad_title" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "ad_url" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "ad_app" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "ctwa_clid" text;--> statement-breakpoint
ALTER TABLE "capi_events" ADD CONSTRAINT "capi_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_events" ADD CONSTRAINT "capi_events_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_settings" ADD CONSTRAINT "meta_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capi_events_deal_event_uq" ON "capi_events" USING btree ("deal_id","event_name");--> statement-breakpoint
CREATE INDEX "capi_events_status_idx" ON "capi_events" USING btree ("status","created_at");