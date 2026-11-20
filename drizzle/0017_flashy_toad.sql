ALTER TABLE "experiences_gaps" ALTER COLUMN "start_month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences_gaps" ALTER COLUMN "end_month" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "experiences_moves_user_affiliate_idx" ON "experiences_moves" USING btree ("user_id") WHERE "experiences_moves"."step" = 'affiliate';