import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { getDb, type Executor } from "@/db";
import { cardEvents, cardTokens, departments, institutions, institutionSettings, nfcCards, programmes, sections, students, users } from "@/db/schema";
import { decrypt, encrypt, generateToken, sha256 } from "@/lib/crypto";
import { badRequest } from "@/lib/errors";
import { normalizeConfig } from "@/lib/portal-config";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { owned } from "./guard";

/**
 * Card model
 * ----------
 * - The NFC tag stores ONLY an HTTPS URL: {APP_URL}/card/{token}
 * - token = 32 random bytes (base64url, 256-bit). We store sha256(token) for
 *   lookup plus an AES-GCM ciphertext so admins can re-encode / re-print QR.
 * - The token locates a student's *public* ID view. It is NOT a credential:
 *   private records always require the student to sign in.
 * - Rotating/revoking invalidates the old URL immediately.
 */

export function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function cardUrl(token: string) {
  return `${appUrl()}/card/${token}`;
}

async function issueToken(ctx: TenantContext, cardId: string, tx: Executor) {
  const token = generateToken(32);
  await tx.insert(cardTokens).values({ institutionId: ctx.institution.id, cardId, tokenHash: sha256(token), tokenEncrypted: encrypt(token) });
  return token;
}

async function revokeTokens(ctx: TenantContext, cardId: string, reason: string, tx: Executor) {
  await tx
    .update(cardTokens)
    .set({ status: "revoked", revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(cardTokens.cardId, cardId), eq(cardTokens.institutionId, ctx.institution.id), eq(cardTokens.status, "active")));
}

async function event(ctx: TenantContext, tx: Executor, cardId: string, studentId: string | null, action: string, notes?: string) {
  await tx.insert(cardEvents).values({ institutionId: ctx.institution.id, cardId, studentId, action, notes: notes ?? null, actorUserId: ctx.user.id });
}

export async function registerCards(ctx: TenantContext, serials: string[]) {
  assertAdminWrite(ctx, "cards.manage");
  const clean = [...new Set(serials.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!clean.length) throw badRequest("Enter at least one card serial / UID.");
  if (clean.length > 1000) throw badRequest("Register at most 1,000 cards at a time.");
  for (const s of clean) if (!/^[A-Z0-9:-]{4,40}$/.test(s)) throw badRequest(`Invalid serial "${s}". Use 4–40 letters, digits, ':' or '-'.`);
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(nfcCards)
      .values(clean.map((serial) => ({ institutionId: ctx.institution.id, serial })))
      .onConflictDoNothing()
      .returning();
    for (const r of rows) await event(ctx, tx, r.id, null, "registered");
    await audit(ctx, { action: "card.register", entityType: "nfc_card", summary: `Registered ${rows.length} card(s)${clean.length - rows.length ? `, ${clean.length - rows.length} duplicate(s) skipped` : ""}` }, tx);
    return { created: rows.length, skipped: clean.length - rows.length };
  });
}

async function activeCardFor(studentId: string, tx: Executor, excludeCardId?: string) {
  const conds = [eq(nfcCards.studentId, studentId), inArray(nfcCards.status, ["active", "inactive"])];
  if (excludeCardId) conds.push(ne(nfcCards.id, excludeCardId));
  const [c] = await tx.select().from(nfcCards).where(and(...conds)).limit(1);
  return c;
}

/**
 * Assign an unassigned card to a student and issue its URL token. If the student only has the
 * digital card issued with their record, the physical card takes over that card's URL, so a link
 * already written to a tag or shared keeps working.
 */
export async function assignCard(ctx: TenantContext, cardId: string, studentId: string, validUntil: string | null) {
  assertAdminWrite(ctx, "cards.manage");
  const card = await owned(ctx, nfcCards, cardId, "Card");
  const s = await owned(ctx, students, studentId, "Student");
  if (card.status !== "unassigned") throw badRequest("Only unassigned cards can be assigned. Use Replace for lost or damaged cards.");
  if (s.status === "archived") throw badRequest("Cannot assign a card to an archived student.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await activeCardFor(s.id, tx);
    if (existing && !existing.digital) throw badRequest(`${s.enrollmentNo} already has card ${existing.serial}. Use Replace instead.`);
    let token: string;
    if (existing) {
      await tx.update(nfcCards).set({ studentId: s.id, status: existing.status, assignedAt: new Date(), validUntil: validUntil ?? existing.validUntil }).where(eq(nfcCards.id, card.id));
      await tx.update(cardTokens).set({ cardId: card.id }).where(and(eq(cardTokens.cardId, existing.id), eq(cardTokens.institutionId, ctx.institution.id), eq(cardTokens.status, "active")));
      await tx.update(nfcCards).set({ status: "revoked" }).where(eq(nfcCards.id, existing.id));
      await event(ctx, tx, existing.id, s.id, "revoked", `Superseded by physical card ${card.serial} (same URL)`);
      const live = await liveTokenIn(ctx, card.id, tx);
      token = live ?? (await issueToken(ctx, card.id, tx));
    } else {
      await tx.update(nfcCards).set({ studentId: s.id, status: "active", assignedAt: new Date(), validUntil }).where(eq(nfcCards.id, card.id));
      token = await issueToken(ctx, card.id, tx);
    }
    await event(ctx, tx, card.id, s.id, "assigned", existing ? `Took over the URL of ${existing.serial}` : undefined);
    await audit(ctx, { action: "card.assign", entityType: "nfc_card", entityId: card.id, summary: `Assigned card ${card.serial} to ${s.enrollmentNo}` }, tx);
    return { token, url: cardUrl(token) };
  });
}

async function liveTokenIn(ctx: TenantContext, cardId: string, tx: Executor) {
  const [t] = await tx
    .select({ enc: cardTokens.tokenEncrypted })
    .from(cardTokens)
    .where(and(eq(cardTokens.cardId, cardId), eq(cardTokens.institutionId, ctx.institution.id), eq(cardTokens.status, "active")))
    .orderBy(desc(cardTokens.createdAt))
    .limit(1);
  return t ? decrypt(t.enc) : null;
}

/** "2026-27" → 2027-06-30 (end of that academic year); otherwise, or if already past, one year from today. */
export function defaultCardValidity(academicYear: string | null | undefined, today = new Date()) {
  const todayIso = today.toISOString().slice(0, 10);
  const m = academicYear?.match(/^(\d{4})\s*[-/–]\s*(\d{2}|\d{4})$/);
  if (m) {
    const end = m[2].length === 2 ? Number(m[1].slice(0, 2) + m[2]) + (m[2] < m[1].slice(2) ? 100 : 0) : Number(m[2]);
    const iso = `${end}-06-30`;
    if (iso >= todayIso) return iso;
  }
  const d = new Date(today);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

const serialBase = (enrollmentNo: string) => `ID-${enrollmentNo.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`.slice(0, 34).replace(/-+$/, "");

/**
 * Give each student without a live card a digital card and its NFC URL, so the link exists the
 * moment the student is created. Students who already have a live card are skipped.
 * Runs inside the caller's transaction; returns studentId → URL for the cards it created.
 */
export async function issueStudentCards(ctx: TenantContext, list: { id: string; enrollmentNo: string; academicYear: string | null }[], tx: Executor) {
  const urls = new Map<string, string>();
  if (!list.length) return urls;
  const ids = list.map((s) => s.id);
  const live = await tx
    .select({ studentId: nfcCards.studentId })
    .from(nfcCards)
    .where(and(eq(nfcCards.institutionId, ctx.institution.id), inArray(nfcCards.studentId, ids), inArray(nfcCards.status, ["active", "inactive"])));
  const has = new Set(live.map((r) => r.studentId));
  const todo = list.filter((s) => !has.has(s.id));
  if (!todo.length) return urls;

  const taken = new Set(
    (await tx.select({ serial: nfcCards.serial }).from(nfcCards).where(and(eq(nfcCards.institutionId, ctx.institution.id), ilike(nfcCards.serial, "ID-%")))).map((r) => r.serial),
  );
  const now = new Date();
  const rows = todo.map((s) => {
    const base = serialBase(s.enrollmentNo) || "ID-CARD";
    let serial = base;
    for (let i = 2; taken.has(serial); i++) serial = `${base}-${i}`;
    taken.add(serial);
    return { institutionId: ctx.institution.id, serial, status: "active", studentId: s.id, digital: true, assignedAt: now, validUntil: defaultCardValidity(s.academicYear, now) };
  });

  for (let i = 0; i < rows.length; i += 500) {
    const cards = await tx.insert(nfcCards).values(rows.slice(i, i + 500)).returning({ id: nfcCards.id, studentId: nfcCards.studentId });
    const tokens = cards.map((c) => ({ card: c, token: generateToken(32) }));
    await tx.insert(cardTokens).values(tokens.map((t) => ({ institutionId: ctx.institution.id, cardId: t.card.id, tokenHash: sha256(t.token), tokenEncrypted: encrypt(t.token) })));
    await tx.insert(cardEvents).values(cards.map((c) => ({ institutionId: ctx.institution.id, cardId: c.id, studentId: c.studentId, action: "issued", notes: "Digital card issued with the student record", actorUserId: ctx.user.id })));
    for (const t of tokens) urls.set(t.card.studentId!, cardUrl(t.token));
  }
  return urls;
}

/** Issue card links for every active student who does not have a live card yet (e.g. records created before auto-issue). */
export async function issueMissingCards(ctx: TenantContext, studentId?: string) {
  assertAdminWrite(ctx, "cards.manage");
  const conds = [eq(students.institutionId, ctx.institution.id), ne(students.status, "archived")];
  if (studentId) conds.push(eq(students.id, studentId));
  const list = await getDb().select({ id: students.id, enrollmentNo: students.enrollmentNo, academicYear: students.academicYear }).from(students).where(and(...conds));
  return getDb().transaction(async (tx) => {
    const urls = await issueStudentCards(ctx, list, tx);
    if (urls.size) await audit(ctx, { action: "card.issue", entityType: "nfc_card", summary: `Issued ${urls.size} digital card link(s)` }, tx);
    return urls.size;
  });
}

/** The student's live card (active or inactive) and its URL, if any. */
export async function liveCardForStudent(ctx: TenantContext, studentId: string) {
  assertCan(ctx, "cards.manage");
  const [c] = await getDb()
    .select()
    .from(nfcCards)
    .where(and(eq(nfcCards.institutionId, ctx.institution.id), eq(nfcCards.studentId, studentId), inArray(nfcCards.status, ["active", "inactive"])))
    .orderBy(desc(nfcCards.assignedAt))
    .limit(1);
  if (!c) return null;
  const live = await liveTokenForCard(ctx, c.id);
  return { card: c, url: live?.url ?? null, tapCount: live?.tapCount ?? 0 };
}

export async function setCardActive(ctx: TenantContext, cardId: string, active: boolean) {
  assertAdminWrite(ctx, "cards.manage");
  const card = await owned(ctx, nfcCards, cardId, "Card");
  if (!card.studentId || !["active", "inactive"].includes(card.status)) throw badRequest("Only assigned cards can be activated or deactivated.");
  const db = getDb();
  await db.transaction(async (tx) => {
    if (active) {
      const other = await activeCardFor(card.studentId!, tx, card.id);
      if (other) throw badRequest(`Student already has another live card (${other.serial}).`);
    }
    await tx.update(nfcCards).set({ status: active ? "active" : "inactive" }).where(eq(nfcCards.id, card.id));
    await event(ctx, tx, card.id, card.studentId, active ? "activated" : "deactivated");
    await audit(ctx, { action: active ? "card.activate" : "card.deactivate", entityType: "nfc_card", entityId: card.id, summary: `${active ? "Activated" : "Deactivated"} card ${card.serial}` }, tx);
  });
}

/** Mark a card lost/damaged/revoked: permanently kills its tokens. */
export async function retireCard(ctx: TenantContext, cardId: string, reason: "lost" | "damaged" | "revoked", notes?: string) {
  assertAdminWrite(ctx, "cards.manage");
  const card = await owned(ctx, nfcCards, cardId, "Card");
  if (["lost", "damaged", "revoked"].includes(card.status)) throw badRequest("Card is already retired.");
  const db = getDb();
  await db.transaction(async (tx) => {
    await revokeTokens(ctx, card.id, reason, tx);
    await tx.update(nfcCards).set({ status: reason }).where(eq(nfcCards.id, card.id));
    await event(ctx, tx, card.id, card.studentId, reason === "revoked" ? "revoked" : `reported_${reason}`, notes);
    await audit(ctx, { action: `card.${reason}`, entityType: "nfc_card", entityId: card.id, summary: `Card ${card.serial} marked ${reason}${notes ? `: ${notes}` : ""}` }, tx);
  });
}

/**
 * Replace a student's card: retires the old one (lost/damaged) and re-links a
 * new card to the SAME student record with a fresh token.
 */
export async function replaceCard(ctx: TenantContext, oldCardId: string, newCardId: string, reason: "lost" | "damaged") {
  assertAdminWrite(ctx, "cards.manage");
  const oldCard = await owned(ctx, nfcCards, oldCardId, "Card");
  const newCard = await owned(ctx, nfcCards, newCardId, "Replacement card");
  if (!oldCard.studentId) throw badRequest("The old card is not linked to a student.");
  if (newCard.status !== "unassigned") throw badRequest("The replacement must be an unassigned card.");
  const studentId = oldCard.studentId;
  const db = getDb();
  return db.transaction(async (tx) => {
    if (!["lost", "damaged", "revoked"].includes(oldCard.status)) {
      await revokeTokens(ctx, oldCard.id, `replaced (${reason})`, tx);
      await tx.update(nfcCards).set({ status: reason }).where(eq(nfcCards.id, oldCard.id));
      await event(ctx, tx, oldCard.id, studentId, `reported_${reason}`);
    }
    await tx.update(nfcCards).set({ studentId, status: "active", assignedAt: new Date(), validUntil: oldCard.validUntil }).where(eq(nfcCards.id, newCard.id));
    const token = await issueToken(ctx, newCard.id, tx);
    await event(ctx, tx, newCard.id, studentId, "replaced", `Replaces ${oldCard.serial}`);
    await audit(ctx, { action: "card.replace", entityType: "nfc_card", entityId: newCard.id, summary: `Replaced ${oldCard.serial} (${reason}) with ${newCard.serial}` }, tx);
    return { token, url: cardUrl(token) };
  });
}

/** Invalidate the current URL and issue a new one on the same physical card (re-encode required). */
export async function rotateCardToken(ctx: TenantContext, cardId: string) {
  assertAdminWrite(ctx, "cards.manage");
  const card = await owned(ctx, nfcCards, cardId, "Card");
  if (!card.studentId || !["active", "inactive"].includes(card.status)) throw badRequest("Only assigned cards have tokens to rotate.");
  const db = getDb();
  return db.transaction(async (tx) => {
    await revokeTokens(ctx, card.id, "rotated", tx);
    const token = await issueToken(ctx, card.id, tx);
    await event(ctx, tx, card.id, card.studentId, "token_rotated");
    await audit(ctx, { action: "card.rotate", entityType: "nfc_card", entityId: card.id, summary: `Rotated URL token for card ${card.serial}` }, tx);
    return { token, url: cardUrl(token) };
  });
}

/** Decrypt the live token so the admin can re-encode the tag or print the QR fallback. */
export async function liveTokenForCard(ctx: TenantContext, cardId: string) {
  assertCan(ctx, "cards.manage");
  const card = await owned(ctx, nfcCards, cardId, "Card");
  const [t] = await getDb()
    .select()
    .from(cardTokens)
    .where(and(eq(cardTokens.cardId, card.id), eq(cardTokens.institutionId, ctx.institution.id), eq(cardTokens.status, "active")))
    .orderBy(desc(cardTokens.createdAt))
    .limit(1);
  if (!t) return null;
  const token = decrypt(t.tokenEncrypted);
  return { token, url: cardUrl(token), tapCount: t.tapCount, lastTappedAt: t.lastTappedAt };
}

export async function listCards(ctx: TenantContext, filter: { status?: string; q?: string }) {
  assertCan(ctx, "cards.manage");
  const conds = [eq(nfcCards.institutionId, ctx.institution.id)];
  if (filter.status && filter.status !== "all") conds.push(eq(nfcCards.status, filter.status));
  if (filter.q?.trim()) conds.push(or(ilike(nfcCards.serial, `%${filter.q.trim()}%`), ilike(students.enrollmentNo, `%${filter.q.trim()}%`), ilike(students.fullName, `%${filter.q.trim()}%`))!);
  return getDb()
    .select({ card: nfcCards, studentName: students.fullName, enrollmentNo: students.enrollmentNo })
    .from(nfcCards)
    .leftJoin(students, eq(students.id, nfcCards.studentId))
    .where(and(...conds))
    .orderBy(desc(nfcCards.createdAt))
    .limit(300);
}

export async function cardCounts(ctx: TenantContext) {
  const rows = await getDb()
    .select({ status: nfcCards.status, n: sql<number>`count(*)::int` })
    .from(nfcCards)
    .where(eq(nfcCards.institutionId, ctx.institution.id))
    .groupBy(nfcCards.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return { active: by.active ?? 0, inactive: by.inactive ?? 0, unassigned: by.unassigned ?? 0, revoked: (by.revoked ?? 0) + (by.lost ?? 0) + (by.damaged ?? 0), assigned: (by.active ?? 0) + (by.inactive ?? 0), total: rows.reduce((s, r) => s + r.n, 0) };
}

export async function cardHistory(ctx: TenantContext, cardId: string) {
  assertCan(ctx, "cards.manage");
  await owned(ctx, nfcCards, cardId, "Card");
  return getDb()
    .select({ event: cardEvents, actor: users.name, enrollmentNo: students.enrollmentNo })
    .from(cardEvents)
    .leftJoin(users, eq(users.id, cardEvents.actorUserId))
    .leftJoin(students, eq(students.id, cardEvents.studentId))
    .where(and(eq(cardEvents.cardId, cardId), eq(cardEvents.institutionId, ctx.institution.id)))
    .orderBy(asc(cardEvents.createdAt));
}

export async function cardsForStudent(ctx: TenantContext, studentId: string) {
  return getDb()
    .select()
    .from(nfcCards)
    .where(and(eq(nfcCards.institutionId, ctx.institution.id), eq(nfcCards.studentId, studentId)))
    .orderBy(desc(nfcCards.createdAt));
}

export async function unassignedCards(ctx: TenantContext) {
  return getDb()
    .select({ id: nfcCards.id, serial: nfcCards.serial })
    .from(nfcCards)
    .where(and(eq(nfcCards.institutionId, ctx.institution.id), eq(nfcCards.status, "unassigned")))
    .orderBy(asc(nfcCards.serial))
    .limit(500);
}

// ---------------------------------------------------------------- Public tap resolution

export type PublicCardView =
  | { state: "invalid" }
  | { state: "inactive"; institution: { name: string; slug: string } }
  | {
      state: "ok";
      institution: { name: string; shortName: string; slug: string; collegeAddress: string | null; city: string | null; state: string | null; pincode: string | null; contactPhone: string | null; principalName: string | null; principalSignatureFileId: string | null };
      branding: { primaryColor: string; accentColor: string; logoFileId: string | null };
      fields: Record<string, string | null>;
      photoAvailable: boolean;
      studentId: string;
      cardStatus: string;
    };

/** Resolve a tapped token to the PUBLIC id view only. Never returns private fields. */
export async function resolveCardToken(token: string, opts: { countTap?: boolean } = {}): Promise<PublicCardView> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { state: "invalid" };
  const db = getDb();
  const [row] = await db
    .select({ token: cardTokens, card: nfcCards, institution: institutions })
    .from(cardTokens)
    .innerJoin(nfcCards, eq(nfcCards.id, cardTokens.cardId))
    .innerJoin(institutions, eq(institutions.id, cardTokens.institutionId))
    .where(eq(cardTokens.tokenHash, sha256(token)))
    .limit(1);
  if (!row || row.token.status !== "active") return { state: "invalid" };
  const inst = { name: row.institution.name, slug: row.institution.slug };
  const expired = row.card.validUntil && row.card.validUntil < new Date().toISOString().slice(0, 10);
  if (row.card.status !== "active" || row.institution.status !== "active" || !row.card.studentId || expired) return { state: "inactive", institution: inst };

  if (opts.countTap !== false) await db.update(cardTokens).set({ tapCount: sql`${cardTokens.tapCount} + 1`, lastTappedAt: new Date() }).where(eq(cardTokens.id, row.token.id));

  const [s] = await db
    .select({ student: students, departmentName: departments.name, programmeName: programmes.name, sectionName: sections.name })
    .from(students)
    .leftJoin(departments, eq(departments.id, students.departmentId))
    .leftJoin(programmes, eq(programmes.id, students.programmeId))
    .leftJoin(sections, eq(sections.id, students.sectionId))
    .where(and(eq(students.id, row.card.studentId), eq(students.institutionId, row.institution.id)))
    .limit(1);
  if (!s || s.student.status === "archived") return { state: "inactive", institution: inst };

  const [settings] = await db.select().from(institutionSettings).where(eq(institutionSettings.institutionId, row.institution.id)).limit(1);
  const cfg = normalizeConfig(settings?.publishedConfig, row.institution.licensedModules);
  const allowed = new Set(cfg.publicFields);
  const all: Record<string, string | null> = {
    fullName: s.student.fullName,
    enrollmentNo: s.student.enrollmentNo,
    registerNo: s.student.registerNo,
    rollNo: s.student.rollNo,
    classTeacher: s.student.classTeacher,
    internship: s.student.internship,
    department: s.departmentName,
    programme: s.programmeName,
    semester: String(s.student.semester),
    academicYear: s.student.academicYear,
    status: s.student.status,
    cardValidity: row.card.validUntil,
    bloodGroup: s.student.bloodGroup,
    section: s.sectionName,
    admissionYear: s.student.admissionYear ? String(s.student.admissionYear) : null,
    gender: s.student.gender,
    dateOfBirth: s.student.dateOfBirth,
    email: s.student.email,
    phone: s.student.phone,
    guardianName: s.student.guardianName,
    guardianPhone: s.student.guardianPhone,
    address: s.student.address,
  };
  const fields = Object.fromEntries(Object.entries(all).filter(([k]) => allowed.has(k)));
  return {
    state: "ok",
    institution: {
      name: row.institution.name,
      shortName: row.institution.shortName,
      slug: row.institution.slug,
      // College details printed on every card; not student data.
      collegeAddress: row.institution.address,
      city: row.institution.city,
      state: row.institution.state,
      pincode: row.institution.pincode,
      contactPhone: row.institution.contactPhone,
      principalName: row.institution.principalName,
      principalSignatureFileId: row.institution.principalSignatureFileId,
    },
    branding: { primaryColor: cfg.branding.primaryColor, accentColor: cfg.branding.accentColor, logoFileId: cfg.branding.logoFileId },
    fields,
    photoAvailable: allowed.has("photo") && !!s.student.photoFileId,
    studentId: s.student.id,
    cardStatus: row.card.status,
  };
}
