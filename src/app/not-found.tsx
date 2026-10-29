import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <p className="text-sm font-medium text-brand">404</p>
        <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The page you are looking for does not exist or has moved.</p>
        <div className="mt-6">
          <LinkButton href="/">Back to home</LinkButton>
        </div>
      </div>
    </main>
  );
}
