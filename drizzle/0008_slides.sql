CREATE TABLE "slides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"headline" text NOT NULL,
	"body" text,
	"cta_label" text,
	"cta_href" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_on" text,
	"ends_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
