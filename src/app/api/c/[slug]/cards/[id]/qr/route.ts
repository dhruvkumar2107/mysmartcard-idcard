import QRCode from "qrcode";
import { AppError } from "@/lib/errors";
import { loadTenantContext } from "@/server/context";
import { getSessionUser } from "@/server/session";
import { liveTokenForCard } from "@/server/services/cards";

/** Printable QR fallback for a card's live URL. Admin-only; never cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  try {
    const ctx = await loadTenantContext(user, slug);
    const live = await liveTokenForCard(ctx, id);
    if (!live) return new Response("Card has no active URL", { status: 404 });
    const svg = await QRCode.toString(live.url, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 320 });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
