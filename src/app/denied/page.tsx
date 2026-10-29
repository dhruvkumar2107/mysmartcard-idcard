import { ShieldAlert } from "lucide-react";
import { LinkButton } from "@/components/ui";
import { one, type Props } from "@/lib/page";

export const metadata = { title: "Access denied" };

export default async function Denied({ searchParams }: Props) {
  const reason = one((await searchParams).reason);
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="max-w-md text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-danger" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">Access denied</h1>
        <p className="mt-2 text-sm text-muted">{reason && reason !== "platform" ? reason.slice(0, 200) : "You do not have permission to view this page."}</p>
        <div className="mt-6 flex justify-center gap-2">
          <LinkButton href="/">Go to my workspaces</LinkButton>
        </div>
      </div>
    </main>
  );
}
