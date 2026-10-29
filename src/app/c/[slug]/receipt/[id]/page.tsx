import { PrintButton } from "@/components/client";
import { formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import type { SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { receipt } from "@/server/services/finance";

export const metadata = { title: "Fee receipt" };

/** Printable receipt. Students may open only their own; staff need fees.view. */
export default async function ReceiptPage({ params }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const ctx = await requireTenant(slug);
  const r = await orNotFound(receipt(ctx, id));
  const b = ctx.portalConfig.branding;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-4 flex justify-end">
        <PrintButton />
      </div>
      <article className="rounded-xl border border-line bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-line pb-4">
          <div className="flex items-center gap-3">
            {b.logoFileId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${b.logoFileId}`} alt="" className="h-12 w-12 object-contain" />
            )}
            <div>
              <h1 className="text-lg font-semibold">{ctx.institution.name}</h1>
              {ctx.institution.city && <p className="text-sm text-muted">{ctx.institution.city}</p>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted">Fee receipt</div>
            <div className="font-mono font-semibold">{r.payment.receiptNo}</div>
          </div>
        </header>
        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted">Received from</dt>
            <dd className="font-medium">{r.student.fullName}</dd>
            <dd className="font-mono text-xs">{r.student.enrollmentNo}</dd>
          </div>
          <div className="text-right">
            <dt className="text-muted">Payment date</dt>
            <dd className="font-medium">{formatDate(r.payment.paidAt)}</dd>
          </div>
          <div>
            <dt className="text-muted">Towards</dt>
            <dd>{r.demand ? `${titleCase(r.demand.category)} — ${r.demand.description ?? ""} (${r.demand.academicYear})` : "General fee payment"}</dd>
          </div>
          <div className="text-right">
            <dt className="text-muted">Method / reference</dt>
            <dd>
              {titleCase(r.payment.method)}
              {r.payment.reference ? ` · ${r.payment.reference}` : ""}
            </dd>
          </div>
        </dl>
        <div className="mt-8 flex items-center justify-between rounded-lg bg-surface-2 px-5 py-4">
          <span className="text-sm">Amount received</span>
          <span className="text-2xl font-semibold tabular-nums">{formatMoney(r.payment.amount)}</span>
        </div>
        <footer className="mt-8 flex justify-between text-xs text-muted">
          <span>Recorded by {r.recordedBy ?? "Accounts office"} · {formatDateTime(r.payment.createdAt)}</span>
          <span>{r.payment.reconciled ? "Reconciled" : "Pending reconciliation"}</span>
        </footer>
        <p className="mt-6 text-center text-[11px] text-muted">This is a computer-generated receipt issued through MySmartCard Campus.</p>
      </article>
    </main>
  );
}
