import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { nfcCards } from "@/db/schema";
import { Alert, Card, Field, Flash, Input, KV, LinkButton, PageHeader, Select, StatusBadge, TenantFields } from "@/components/ui";
import { CopyButton, PrintButton, SubmitButton } from "@/components/client";
import { formatDate, formatDateTime } from "@/lib/format";
import { flashOf, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { cardHistory, liveTokenForCard, unassignedCards } from "@/server/services/cards";
import { owned } from "@/server/services/guard";
import { students } from "@/db/schema";
import { cardOpAction } from "@/server/actions/admin";

export const metadata = { title: "Card details" };

export default async function CardDetail({ params, searchParams }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const ctx = await requireTenant(slug, "cards.manage");
  const card = await orNotFound(owned(ctx, nfcCards, id, "Card"));
  const [live, history, pool, student] = await Promise.all([
    liveTokenForCard(ctx, id),
    cardHistory(ctx, id),
    unassignedCards(ctx),
    card.studentId ? getDb().select().from(students).where(eq(students.id, card.studentId)).then((r) => r[0]) : null,
  ]);
  const back = `/c/${slug}/admin/cards/${id}`;
  const retired = ["lost", "damaged", "revoked"].includes(card.status);
  const op = (value: string, label: string, variant: "primary" | "secondary" | "danger" = "secondary", confirm?: string) => (
    <form action={cardOpAction}>
      <TenantFields slug={slug} back={back} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={value} />
      <SubmitButton variant={variant} confirm={confirm}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader title={`Card ${card.serial}`} back={{ href: `/c/${slug}/admin/cards`, label: "Cards" }} actions={student && ctx.perms.has("portal.configure") ? <LinkButton href={`/c/${slug}/admin/preview/${student.id}`}>Preview student portal</LinkButton> : undefined} />
      <Flash searchParams={flashOf(await searchParams)} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Card">
            <KV
              items={[
                ["Status", <StatusBadge key="s" status={card.status} />],
                ["Student", student ? <Link key="st" href={`/c/${slug}/admin/students/${student.id}?tab=card`} className="text-brand hover:underline">{`${student.enrollmentNo} · ${student.fullName}`}</Link> : "Not assigned"],
                ["Assigned", formatDateTime(card.assignedAt)],
                ["Valid until", formatDate(card.validUntil)],
                ["Taps on current URL", live ? live.tapCount : "—"],
                ["Last tapped", live?.lastTappedAt ? formatDateTime(live.lastTappedAt) : "—"],
              ]}
            />
          </Card>

          {live ? (
            <Card title="Encode this URL onto the NFC tag" description="Write it as an NDEF URI record with any NFC writer app, then lock the tag. No student data is stored on the card.">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="block min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 text-xs">{live.url}</code>
                <CopyButton text={live.url} label="Copy URL" />
              </div>
              <p className="mt-3 text-xs text-muted">Treat this URL like the physical card: anyone with it can see the public ID fields you allow in the Portal designer — never private records.</p>
            </Card>
          ) : (
            <Alert tone={retired ? "danger" : "info"}>{retired ? "This card is retired. Its URL has been revoked and no longer opens a student profile." : "This card has no URL yet. Assign it to a student to issue one."}</Alert>
          )}

          {!retired && card.studentId && (
            <Card title="Lifecycle">
              <div className="flex flex-wrap gap-2">
                {card.status === "active" ? op("deactivate", "Deactivate") : op("activate", "Activate", "primary")}
                {op("rotate", "Issue new URL (revoke old)", "secondary", "The current URL will stop working immediately. Re-encode the tag afterwards. Continue?")}
                {op("lost", "Report lost", "danger", "Mark this card lost? Its URL is revoked permanently.")}
                {op("damaged", "Report damaged", "danger", "Mark this card damaged? Its URL is revoked permanently.")}
              </div>
            </Card>
          )}

          {card.studentId && card.status !== "revoked" && (
            <Card title="Replace card" description="Retires this card and links a new card to the same student record with a fresh URL.">
              {pool.length === 0 ? (
                <p className="text-sm text-muted">No unassigned cards in stock. Register more on the cards page.</p>
              ) : (
                <form action={cardOpAction} className="grid gap-3 sm:grid-cols-3">
                  <TenantFields slug={slug} back={back} />
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="op" value="replace" />
                  <Field label="Replacement card">
                    <Select name="newCardId" required options={pool.map((c) => ({ value: c.id, label: c.serial }))} />
                  </Field>
                  <Field label="Reason">
                    <Select name="reason" options={[{ value: "lost", label: "Lost" }, { value: "damaged", label: "Damaged" }]} />
                  </Field>
                  <div className="flex items-end">
                    <SubmitButton confirm="Replace this card? The old card's URL will stop working.">Replace</SubmitButton>
                  </div>
                </form>
              )}
            </Card>
          )}

          {!retired && card.studentId && (
            <Card title="Revoke permanently">
              <form action={cardOpAction} className="flex flex-col gap-3 sm:flex-row">
                <TenantFields slug={slug} back={back} />
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="op" value="revoked" />
                <Input name="notes" placeholder="Reason (recorded in audit log)" className="flex-1" aria-label="Reason" />
                <SubmitButton variant="danger" confirm="Revoke this card permanently?">
                  Revoke
                </SubmitButton>
              </form>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {live && (
            <Card title="QR fallback" description="For phones without NFC. Print and attach to the card sleeve.">
              <div className="rounded-lg border border-line bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/c/${slug}/cards/${id}/qr`} alt={`QR code for card ${card.serial}`} className="mx-auto w-full max-w-[240px]" />
                <p className="mt-2 text-center font-mono text-xs">{card.serial}</p>
              </div>
              <div className="mt-3 flex gap-2">
                <PrintButton />
                <a href={`/api/c/${slug}/cards/${id}/qr`} download={`${card.serial}.svg`} className="inline-flex items-center rounded-lg border border-line px-3 text-sm hover:bg-surface-2">
                  Download SVG
                </a>
              </div>
            </Card>
          )}
          <Card title="Assignment history" padded={false}>
            <ol className="divide-y divide-line">
              {history.map((h) => (
                <li key={h.event.id} className="px-5 py-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{h.event.action.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted">{formatDateTime(h.event.createdAt)}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {h.enrollmentNo ? `${h.enrollmentNo} · ` : ""}
                    {h.actor ?? "system"}
                    {h.event.notes ? ` · ${h.event.notes}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
