CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"output" jsonb,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"audience" text DEFAULT 'customers' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"updated_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_requests_user_id_created_at_index" ON "ai_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_subject_type_subject_id_index" ON "ai_requests" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "kb_articles_status_audience_index" ON "kb_articles" USING btree ("status","audience");--> statement-breakpoint
CREATE INDEX "kb_articles_search" ON "kb_articles" USING gin (to_tsvector('english', "title" || ' ' || coalesce("summary", '') || ' ' || "body"));