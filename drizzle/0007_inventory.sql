CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"count_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"expected" integer NOT NULL,
	"counted" integer,
	"system_at_count" integer,
	"counted_at" timestamp with time zone,
	"unit_cost_minor" bigint,
	CONSTRAINT "stock_count_lines_count_id_variant_id_unique" UNIQUE("count_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"location_id" uuid NOT NULL,
	"category_id" uuid,
	"blind" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"variance_value_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "stock_serials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"location_id" uuid,
	"order_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sold_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "stock_serials_variant_id_serial_unique" UNIQUE("variant_id","serial")
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transfer_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"serials" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "stock_transfer_lines_transfer_id_variant_id_unique" UNIQUE("transfer_id","variant_id"),
	CONSTRAINT "transfer_qty_positive" CHECK ("stock_transfer_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"dispatched_by" uuid,
	"dispatched_at" timestamp with time zone,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "serials" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "reorder_point" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "reorder_qty" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "serial_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "preferred_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "low_stock_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD COLUMN "kind" text DEFAULT 'warehouse' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD COLUMN "sellable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "unit_cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "warranties" ADD COLUMN "serials" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_location_id_stock_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_location_id_stock_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_location_id_stock_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_location_id_stock_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_serials_serial_index" ON "stock_serials" USING btree ("serial");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_barcode_unique" ON "product_variants" USING btree ("barcode") WHERE "product_variants"."barcode" IS NOT NULL;--> statement-breakpoint
UPDATE "stock_locations" SET "kind" = 'partner' WHERE "connection_id" IS NOT NULL;--> statement-breakpoint
UPDATE "stock_locations" SET "is_default" = true WHERE "id" = (SELECT "id" FROM "stock_locations" WHERE "connection_id" IS NULL ORDER BY "code" LIMIT 1);
