import { CreditCard } from "lucide-react";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white shadow-sm">
        <CreditCard className="h-4 w-4" aria-hidden />
      </span>
      <span>
        MySmartCard <span className="text-accent">Campus</span>
      </span>
    </span>
  );
}
