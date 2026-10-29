import { LogOut } from "lucide-react";
import { logout } from "@/server/actions/auth";

export function SignOut() {
  return (
    <form action={logout}>
      <button className="rounded-lg p-2 text-white/80 hover:bg-white/10" aria-label="Sign out" title="Sign out">
        <LogOut className="h-4 w-4" />
      </button>
    </form>
  );
}
