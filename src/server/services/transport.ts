import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { students, transportAssignments, transportRoutes, transportStops } from "@/db/schema";
import { badRequest } from "@/lib/errors";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { owned } from "./guard";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");

export async function listRoutes(ctx: TenantContext) {
  assertCan(ctx, "transport.manage");
  const db = getDb();
  const [routes, stops] = await Promise.all([
    db
      .select({ route: transportRoutes, riders: sql<number>`(select count(*)::int from ${transportAssignments} a where a.route_id = ${ref(transportRoutes.id)})` })
      .from(transportRoutes)
      .where(eq(transportRoutes.institutionId, ctx.institution.id))
      .orderBy(asc(transportRoutes.code)),
    db.select().from(transportStops).where(eq(transportStops.institutionId, ctx.institution.id)).orderBy(asc(transportStops.sequence)),
  ]);
  return routes.map((r) => ({ ...r, stops: stops.filter((s) => s.routeId === r.route.id) }));
}

export async function createRoute(ctx: TenantContext, input: { code: string; name: string; vehicleNo: string | null; driverName: string | null; contactPhone: string | null }) {
  assertAdminWrite(ctx, "transport.manage");
  const d = z.object({ code: z.string().trim().toUpperCase().min(1).max(20), name: z.string().trim().min(2).max(120), vehicleNo: z.string().max(20).nullable(), driverName: z.string().max(80).nullable(), contactPhone: z.string().max(20).nullable() }).parse(input);
  const [row] = await getDb().insert(transportRoutes).values({ ...d, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "transport.route_create", entityType: "transport_route", entityId: row.id, summary: `Created route ${row.code}` });
  return row;
}

export async function updateRoute(ctx: TenantContext, id: string, input: { vehicleNo: string | null; driverName: string | null; contactPhone: string | null; active: boolean }) {
  assertAdminWrite(ctx, "transport.manage");
  const r = await owned(ctx, transportRoutes, id, "Route");
  await getDb().update(transportRoutes).set(input).where(eq(transportRoutes.id, r.id));
  await audit(ctx, { action: "transport.route_update", entityType: "transport_route", entityId: r.id, summary: `Updated route ${r.code}`, metadata: input });
}

export async function addStop(ctx: TenantContext, input: { routeId: string; name: string; sequence: number; pickupTime: string; dropTime: string }) {
  assertAdminWrite(ctx, "transport.manage");
  const d = z.object({ routeId: z.string(), name: z.string().trim().min(2).max(120), sequence: z.number().int().min(1).max(200), pickupTime: hhmm, dropTime: hhmm }).parse(input);
  const r = await owned(ctx, transportRoutes, d.routeId, "Route");
  const [row] = await getDb().insert(transportStops).values({ ...d, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "transport.stop_add", entityType: "transport_route", entityId: r.id, summary: `Added stop ${row.name} to ${r.code}` });
  return row;
}

export async function assignTransport(ctx: TenantContext, input: { enrollmentNo: string; routeId: string; stopId: string | null }) {
  assertAdminWrite(ctx, "transport.manage");
  const r = await owned(ctx, transportRoutes, input.routeId, "Route");
  if (!r.active) throw badRequest("This route is inactive.");
  if (input.stopId) {
    const stop = await owned(ctx, transportStops, input.stopId, "Stop");
    if (stop.routeId !== r.id) throw badRequest("That stop is not on the selected route.");
  }
  const db = getDb();
  const [s] = await db.select().from(students).where(and(eq(students.institutionId, ctx.institution.id), eq(students.enrollmentNo, input.enrollmentNo.trim().toUpperCase()))).limit(1);
  if (!s) throw badRequest("No student with that enrollment number.");
  await db
    .insert(transportAssignments)
    .values({ institutionId: ctx.institution.id, studentId: s.id, routeId: r.id, stopId: input.stopId })
    .onConflictDoUpdate({ target: transportAssignments.studentId, set: { routeId: r.id, stopId: input.stopId } });
  await audit(ctx, { action: "transport.assign", entityType: "student", entityId: s.id, summary: `Assigned ${s.enrollmentNo} to route ${r.code}` });
}

export async function removeTransport(ctx: TenantContext, studentId: string) {
  assertAdminWrite(ctx, "transport.manage");
  const s = await owned(ctx, students, studentId, "Student");
  await getDb().delete(transportAssignments).where(and(eq(transportAssignments.studentId, s.id), eq(transportAssignments.institutionId, ctx.institution.id)));
  await audit(ctx, { action: "transport.unassign", entityType: "student", entityId: s.id, summary: `Removed transport for ${s.enrollmentNo}` });
}

export async function routeRiders(ctx: TenantContext, routeId: string) {
  assertCan(ctx, "transport.manage");
  await owned(ctx, transportRoutes, routeId, "Route");
  return getDb()
    .select({ studentId: students.id, fullName: students.fullName, enrollmentNo: students.enrollmentNo, stop: transportStops.name })
    .from(transportAssignments)
    .innerJoin(students, eq(students.id, transportAssignments.studentId))
    .leftJoin(transportStops, eq(transportStops.id, transportAssignments.stopId))
    .where(and(eq(transportAssignments.institutionId, ctx.institution.id), eq(transportAssignments.routeId, routeId)))
    .orderBy(asc(students.enrollmentNo));
}

export async function transportForStudent(ctx: TenantContext, studentId: string) {
  const [row] = await getDb()
    .select({ route: transportRoutes, stop: transportStops })
    .from(transportAssignments)
    .innerJoin(transportRoutes, eq(transportRoutes.id, transportAssignments.routeId))
    .leftJoin(transportStops, eq(transportStops.id, transportAssignments.stopId))
    .where(and(eq(transportAssignments.institutionId, ctx.institution.id), eq(transportAssignments.studentId, studentId)))
    .limit(1);
  if (!row) return null;
  const stops = await getDb().select().from(transportStops).where(eq(transportStops.routeId, row.route.id)).orderBy(asc(transportStops.sequence));
  return { ...row, stops };
}
