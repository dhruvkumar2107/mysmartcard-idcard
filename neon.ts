import { defineConfig } from "@neon/config/v1";

// Neon infrastructure for MySmartCard Campus. Postgres is implicit; uploads go to a private bucket
// (student photos, documents, notice attachments, coursework, submissions, college logos).
export default defineConfig({
  buckets: {
    uploads: { access: "private" },
  },
});
