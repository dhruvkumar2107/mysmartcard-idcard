"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">The error has been logged. Please try again.</p>
        <button onClick={reset} className="mt-6 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
      </div>
    </main>
  );
}
