import type { ModuleKey } from "./portal-config";

export const PLAN_KEYS = ["starter", "standard", "enterprise"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/**
 * Subscription plans. Every plan gets the complete student ID card (all card fields, college
 * address, principal signature, NFC tap page). Plans differ only in what is listed here:
 * the default student limit and which portal modules are licensed.
 */
export const PLANS: Record<PlanKey, { label: string; studentLimit: number; modules: ModuleKey[]; summary: string }> = {
  starter: {
    label: "Starter",
    studentLimit: 1000,
    modules: ["digital_id", "notices", "timetable"],
    summary: "Up to 1,000 students · Digital ID, Notice Board, Timetable",
  },
  standard: {
    label: "Standard",
    studentLimit: 5000,
    modules: ["digital_id", "notices", "timetable", "results", "internal_marks", "coursework", "attendance"],
    summary: "Up to 5,000 students · Starter + Results, Internal Marks, Assignments, Attendance",
  },
  enterprise: {
    label: "Enterprise",
    studentLimit: 50000,
    modules: ["digital_id", "notices", "timetable", "results", "internal_marks", "coursework", "attendance", "library", "fees", "transport"],
    summary: "Up to 50,000 students · Every module, incl. Library, Fees & Receipts, Transport",
  },
};

export const planLabel = (p: string) => PLANS[p as PlanKey]?.label ?? p;

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;

/** Indian PIN code: six digits, first digit 1–9. */
export const PINCODE_RE = /^[1-9][0-9]{5}$/;

/** "Street, City, State - 560001", skipping blanks and not repeating the city if the street already ends with it. */
export function fullAddress(i: { address?: string | null; city?: string | null; state?: string | null; pincode?: string | null }) {
  const street = i.address?.trim();
  const city = i.city?.trim();
  const parts = [street, city && !street?.toLowerCase().includes(city.toLowerCase()) ? city : null, i.state?.trim()].filter(Boolean);
  const line = parts.join(", ");
  const pin = i.pincode?.trim();
  return pin ? (line ? `${line} - ${pin}` : pin) : line || null;
}
