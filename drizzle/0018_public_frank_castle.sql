ALTER TABLE "experiences_moves" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "experiences_moves" ADD COLUMN "ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "experiences_moves_user_classify_idx" ON "experiences_moves" USING btree ("user_id") WHERE "experiences_moves"."step" = 'classify';