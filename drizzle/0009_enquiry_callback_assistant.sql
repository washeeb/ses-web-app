ALTER TABLE "ai_requests" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preferred_contact" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "callback_on" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "callback_window" text;