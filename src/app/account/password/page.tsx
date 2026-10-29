import { BrandMark } from "@/components/brand";
import { Field, Flash, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { flashOf, one, type Props } from "@/lib/page";
import { requireUser } from "@/server/session";
import { changePassword } from "@/server/actions/auth";

export const metadata = { title: "Change password" };

export default async function PasswordPage({ searchParams }: Props) {
  const user = await requireUser();
  const sp = await searchParams;
  const next = one(sp.next) ?? "/";
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{user.mustChangePassword ? "Set a new password" : "Change password"}</h1>
          <p className="mb-5 text-sm text-muted">
            {user.mustChangePassword ? "You signed in with a one-time password. Choose your own to continue." : "Use at least 10 characters with letters and numbers."}
          </p>
          <Flash searchParams={flashOf(sp)} />
          <form action={changePassword} className="space-y-4">
            <input type="hidden" name="_back" value={`/account/password?next=${encodeURIComponent(next)}`} />
            <input type="hidden" name="next" value={next} />
            <Field label="Current password">
              <Input name="current" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password">
              <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
            <Field label="Confirm new password">
              <Input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
            <SubmitButton className="w-full">Update password</SubmitButton>
          </form>
        </div>
      </div>
    </main>
  );
}
