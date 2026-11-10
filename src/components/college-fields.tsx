import { INDIAN_STATES } from "@/lib/plans";
import { Field, Input, Select, Textarea } from "./ui";

type Values = { address?: string | null; city?: string | null; state?: string | null; pincode?: string | null; contactEmail?: string | null; contactPhone?: string | null; principalName?: string | null };

/** College address and contact fields, shared by onboarding and the platform's college details form. */
export function CollegeAddressFields({ v = {}, wide = true }: { v?: Values; wide?: boolean }) {
  const span = wide ? "sm:col-span-2 lg:col-span-3" : "sm:col-span-2";
  return (
    <>
      <Field label="Address" hint="Building, street and area. Printed on every student ID card." className={span}>
        <Textarea name="address" rows={2} maxLength={300} defaultValue={v.address ?? ""} />
      </Field>
      <Field label="City">
        <Input name="city" maxLength={80} defaultValue={v.city ?? ""} />
      </Field>
      <Field label="State">
        <Select name="state" placeholder="Select state" defaultValue={v.state ?? ""} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} />
      </Field>
      <Field label="PIN code">
        <Input name="pincode" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} title="6-digit PIN code" defaultValue={v.pincode ?? ""} />
      </Field>
      <Field label="Office email">
        <Input name="contactEmail" type="email" defaultValue={v.contactEmail ?? ""} />
      </Field>
      <Field label="Contact number" hint="Printed on ID cards">
        <Input name="contactPhone" type="tel" maxLength={30} defaultValue={v.contactPhone ?? ""} />
      </Field>
      <Field label="Principal name" hint="Shown under the signature on ID cards">
        <Input name="principalName" maxLength={120} defaultValue={v.principalName ?? ""} />
      </Field>
    </>
  );
}
