CREATE TABLE "inactivity_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"from_stage_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"days" integer NOT NULL,
	"to_stage_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inactivity_rules" ADD CONSTRAINT "inactivity_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inactivity_rules" ADD CONSTRAINT "inactivity_rules_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inactivity_rules" ADD CONSTRAINT "inactivity_rules_to_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inactivity_rules_org_idx" ON "inactivity_rules" USING btree ("organization_id");