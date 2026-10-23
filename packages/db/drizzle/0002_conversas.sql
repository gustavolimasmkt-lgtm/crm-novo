CREATE TYPE "public"."conversation_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'other');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"wa_jid" text NOT NULL,
	"phone" text,
	"name" text,
	"push_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"assigned_user_id" uuid,
	"department_id" uuid,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"last_message_from_me" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_media" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"file_name" text,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text,
	"direction" "message_direction" NOT NULL,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"body" text,
	"media_mime" text,
	"media_name" text,
	"status" "message_status" DEFAULT 'sent' NOT NULL,
	"error" text,
	"sent_by_user_id" uuid,
	"raw" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_media" ADD CONSTRAINT "message_media_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_jid_uq" ON "contacts" USING btree ("organization_id","wa_jid");--> statement-breakpoint
CREATE INDEX "contacts_org_phone_idx" ON "contacts" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_conn_contact_uq" ON "conversations" USING btree ("connection_id","contact_id");--> statement-breakpoint
CREATE INDEX "conversations_org_last_idx" ON "conversations" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_assigned_idx" ON "conversations" USING btree ("organization_id","assigned_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conn_external_uq" ON "messages" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","sent_at");