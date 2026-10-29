import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional subdomain tenant routing.
 *
 * With ROOT_DOMAIN=campus.example.com, a request to
 *   northbridge.campus.example.com/admin/students
 * is rewritten to
 *   /c/northbridge/admin/students
 *
 * This is routing only. Authorization is always re-derived on the server from
 * the session + membership (src/server/context.ts), so a forged Host header or
 * a hand-edited /c/<slug> path cannot reach another college's data.
 */
const RESERVED = new Set(["www", "app", "api", "admin", "platform"]);
const PASSTHROUGH = /^\/(c|card|api|login|logout|account|denied|platform|_next|favicon\.ico)(\/|$)/;

export function proxy(req: NextRequest) {
  const root = process.env.ROOT_DOMAIN;
  if (!root) return NextResponse.next();
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!host.endsWith(`.${root}`)) return NextResponse.next();
  const sub = host.slice(0, -(root.length + 1));
  if (!sub || sub.includes(".") || RESERVED.has(sub) || !/^[a-z0-9-]{3,40}$/.test(sub)) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PASSTHROUGH.test(pathname)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = pathname === "/" ? `/c/${sub}/portal` : `/c/${sub}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
