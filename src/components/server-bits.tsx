import { cookies } from "next/headers";
import { KeyRound } from "lucide-react";
import { decrypt } from "@/lib/crypto";

/** Shows credentials stashed by the previous action (encrypted cookie, 2-minute TTL, never in the URL). */
export async function OneTimeCredential() {
  const raw = (await cookies()).get("msc_onetime")?.value;
  if (!raw) return null;
  let text: string;
  try {
    text = decrypt(raw);
  } catch {
    return null;
  }
  return (
    <div role="status" className="mb-5 flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">{text}</p>
        <p className="mt-0.5 text-xs">Copy it now and share it privately — this notice disappears after 5 minutes. The user must choose their own password at first sign-in.</p>
      </div>
    </div>
  );
}
