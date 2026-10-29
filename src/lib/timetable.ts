export const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type SlotLike = {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  sectionId: string;
  facultyId: string | null;
  room: string;
};

export type Conflict = { kind: "faculty" | "room" | "section"; withId?: string; message: string };

export function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time ${hhmm}`);
  return h * 60 + min;
}

export function overlaps(a: Pick<SlotLike, "startTime" | "endTime">, b: Pick<SlotLike, "startTime" | "endTime">) {
  return toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
}

/** Detect teacher, room and class-section double bookings for a candidate slot. */
export function findConflicts(candidate: SlotLike, existing: SlotLike[]): Conflict[] {
  if (toMinutes(candidate.endTime) <= toMinutes(candidate.startTime)) {
    return [{ kind: "section", message: "End time must be after start time." }];
  }
  const out: Conflict[] = [];
  for (const e of existing) {
    if (candidate.id && e.id === candidate.id) continue;
    if (e.dayOfWeek !== candidate.dayOfWeek || !overlaps(candidate, e)) continue;
    const when = `${DAYS[e.dayOfWeek]} ${e.startTime}–${e.endTime}`;
    if (e.sectionId === candidate.sectionId) out.push({ kind: "section", withId: e.id, message: `Section already has a class ${when}.` });
    if (candidate.facultyId && e.facultyId === candidate.facultyId)
      out.push({ kind: "faculty", withId: e.id, message: `Faculty member is already teaching ${when}.` });
    if (e.room.trim().toLowerCase() === candidate.room.trim().toLowerCase())
      out.push({ kind: "room", withId: e.id, message: `Room ${e.room} is already booked ${when}.` });
  }
  return out;
}
