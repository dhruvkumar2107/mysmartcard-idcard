ALTER TABLE "institutions" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "principal_name" text;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "principal_signature_file_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "register_no" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "roll_no" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "class_teacher" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "internship" text;