"use client";

import { useState } from "react";
import { MODULES } from "@/lib/portal-config";
import { PLAN_KEYS, PLANS, type PlanKey } from "@/lib/plans";
import { Checkbox, cn, Field, Input } from "./ui";

/**
 * Plan selector for onboarding and the subscription form. Choosing a plan fills in that plan's
 * student limit and modules; both can still be adjusted afterwards for a custom deal.
 */
export function PlanPicker({ plan: initialPlan, studentLimit, modules: initialModules }: { plan: string; studentLimit: number; modules: string[] }) {
  const [plan, setPlan] = useState<string>(initialPlan);
  const [limit, setLimit] = useState(String(studentLimit));
  const [modules, setModules] = useState<Set<string>>(new Set(initialModules));

  const choose = (p: PlanKey) => {
    setPlan(p);
    setLimit(String(PLANS[p].studentLimit));
    setModules(new Set(PLANS[p].modules));
  };
  const toggle = (k: string, on: boolean) =>
    setModules((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Every plan includes the complete student ID card: all card fields, college address, principal signature, validity and the NFC tap page. Plans differ only in student limit and portal modules:</p>
      <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-3">
        {PLAN_KEYS.map((p) => (
          <label key={p} className={cn("cursor-pointer rounded-xl border p-3 text-sm transition", plan === p ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-line hover:border-muted")}>
            <span className="flex items-center gap-2 font-semibold">
              <input type="radio" name="plan" value={p} checked={plan === p} onChange={() => choose(p)} className="accent-[var(--brand)]" />
              {PLANS[p].label}
            </span>
            <span className="mt-1 block text-xs text-muted">{PLANS[p].summary}</span>
          </label>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Student limit" hint="Prefilled from the plan; change it for a custom deal. Blank = plan default.">
          <Input name="studentLimit" type="number" min={1} max={1000000} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {MODULES.map((m) => (
          <Checkbox key={m.key} name="modules" value={m.key} checked={modules.has(m.key)} onChange={(e) => toggle(m.key, e.target.checked)} label={m.label} />
        ))}
      </div>
      {PLAN_KEYS.includes(plan as PlanKey) && !sameModules(modules, PLANS[plan as PlanKey].modules) && (
        <p className="text-xs text-amber-700">Modules differ from the standard {PLANS[plan as PlanKey].label} plan (custom selection).</p>
      )}
    </div>
  );
}

function sameModules(a: Set<string>, b: readonly string[]) {
  return a.size === b.length && b.every((k) => a.has(k));
}
