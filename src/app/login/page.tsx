import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { Field, Flash, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { flashOf, one, type Props } from "@/lib/page";
import { getSessionUser } from "@/server/session";
import { login } from "@/server/actions/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const next = one(sp.next) ?? "/";
  if (await getSessionUser()) redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mb-5 text-sm text-muted">Staff and students use the account issued by their college.</p>
          <Flash searchParams={flashOf(sp)} />
          <form action={login} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <Field label="Email">
              <Input name="email" type="email" autoComplete="username" required autoFocus />
            </Field>
            <Field label="Password">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <SubmitButton className="w-full">Sign in</SubmitButton>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-muted">Forgot your password? Ask your college administrator to reset portal access.</p>
      </div>
    </main>
  );
}
