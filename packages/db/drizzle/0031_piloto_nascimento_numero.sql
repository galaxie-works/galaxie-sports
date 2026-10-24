ALTER TABLE "core"."participant" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD COLUMN "birth_place" text;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD COLUMN "birth_country_code" text;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD COLUMN "number" smallint;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD CONSTRAINT "participant_birth_country_code_country_code_fk" FOREIGN KEY ("birth_country_code") REFERENCES "core"."country"("code") ON DELETE no action ON UPDATE no action;