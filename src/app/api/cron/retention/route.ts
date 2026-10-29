import { timingSafeEqual } from "node:crypto";
import { runRetention } from "@/server/services/maintenance";

/**
 * Daily data-retention sweep. Vercel Cron calls this with
 * `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET configured the
 * endpoint stays disabled.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runRetention();
  console.log("[cron] retention", result);
  return Response.json({ ok: true, ...result });
}
