-- Show every ID-card field on the NFC tap page for colleges that never changed the old
-- (minimal) default selection. Colleges that customised their tap-page fields are untouched.
UPDATE "institution_settings"
SET "draft_config" = jsonb_set("draft_config", '{publicFields}', '["photo","fullName","enrollmentNo","registerNo","rollNo","department","programme","semester","academicYear","status","cardValidity","bloodGroup","section","classTeacher","internship","admissionYear","gender","dateOfBirth","email","phone","guardianName","guardianPhone","address"]'::jsonb)
WHERE "draft_config"->'publicFields' = '["photo","fullName","enrollmentNo","department","programme","status","cardValidity"]'::jsonb;
--> statement-breakpoint
UPDATE "institution_settings"
SET "published_config" = jsonb_set("published_config", '{publicFields}', '["photo","fullName","enrollmentNo","registerNo","rollNo","department","programme","semester","academicYear","status","cardValidity","bloodGroup","section","classTeacher","internship","admissionYear","gender","dateOfBirth","email","phone","guardianName","guardianPhone","address"]'::jsonb)
WHERE "published_config"->'publicFields' = '["photo","fullName","enrollmentNo","department","programme","status","cardValidity"]'::jsonb;
