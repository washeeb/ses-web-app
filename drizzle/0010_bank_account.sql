-- Synclytics' Absa account is 0341182786 at the Tarkwa branch (corrected 2026-10-31). Only replaces the old
-- defaults if they were saved unchanged in Company settings; values someone typed in are left alone.
UPDATE "settings" SET "value" = '"0341182786"'::jsonb WHERE "key" = 'bankAccountNumber' AND "value" = '"0141159100"'::jsonb;--> statement-breakpoint
UPDATE "settings" SET "value" = '"Tarkwa"'::jsonb WHERE "key" = 'bankBranch' AND "value" = '"Ring Road Central"'::jsonb;
