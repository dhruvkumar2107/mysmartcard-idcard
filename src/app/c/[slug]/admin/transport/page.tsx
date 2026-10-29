import { Badge, Card, Checkbox, EmptyState, Field, Flash, Input, PageHeader, Select, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { listRoutes, routeRiders } from "@/server/services/transport";
import { addStopAction, assignTransportAction, createRouteAction, removeTransportAction, updateRouteAction } from "@/server/actions/admin";

export const metadata = { title: "Transport" };

export default async function TransportPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "transport.manage");
  const routes = await listRoutes(ctx);
  const openRoute = one(sp.route) ?? routes[0]?.route.id;
  const riders = openRoute ? await routeRiders(ctx, openRoute) : [];
  const back = qs(`/c/${slug}/admin/transport`, { route: openRoute });
  const r = routes.find((x) => x.route.id === openRoute);

  return (
    <>
      <PageHeader title="Transport" description="Routes, stops, timings and student assignments. Publish schedule changes from the Notice board with category “Transport”. No live GPS integration is configured." />
      <Flash searchParams={flashOf(sp)} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Routes" padded={false}>
            {routes.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No routes yet" />
              </div>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {routes.map((x) => (
                  <li key={x.route.id}>
                    <a href={qs(`/c/${slug}/admin/transport`, { route: x.route.id })} className={`flex justify-between px-5 py-3 hover:bg-surface-2 ${x.route.id === openRoute ? "bg-surface-2 font-medium" : ""}`}>
                      <span>
                        {x.route.code} · {x.route.name}
                      </span>
                      <span className="flex gap-1">
                        {!x.route.active && <Badge tone="red">inactive</Badge>}
                        <Badge>{x.riders} riders</Badge>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="New route">
            <form action={createRouteAction} className="grid gap-3">
              <TenantFields slug={slug} back={back} />
              <div className="grid grid-cols-3 gap-2">
                <Input name="code" placeholder="R2" required className="uppercase" aria-label="Code" />
                <Input name="name" placeholder="Route name" required className="col-span-2" aria-label="Name" />
              </div>
              <Input name="vehicleNo" placeholder="Vehicle number" aria-label="Vehicle" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="driverName" placeholder="Driver" aria-label="Driver" />
                <Input name="contactPhone" placeholder="Contact phone" aria-label="Phone" />
              </div>
              <SubmitButton variant="secondary">Create route</SubmitButton>
            </form>
          </Card>
        </div>

        {r && (
          <div className="space-y-6 lg:col-span-2">
            <Card title={`Route ${r.route.code} · ${r.route.name}`}>
              <form action={updateRouteAction} className="grid gap-3 sm:grid-cols-4">
                <TenantFields slug={slug} back={back} />
                <input type="hidden" name="id" value={r.route.id} />
                <Field label="Vehicle">
                  <Input name="vehicleNo" defaultValue={r.route.vehicleNo ?? ""} />
                </Field>
                <Field label="Driver">
                  <Input name="driverName" defaultValue={r.route.driverName ?? ""} />
                </Field>
                <Field label="Contact">
                  <Input name="contactPhone" defaultValue={r.route.contactPhone ?? ""} />
                </Field>
                <div className="flex flex-col justify-end gap-2">
                  <Checkbox name="active" defaultChecked={r.route.active} label="Active" />
                  <SubmitButton variant="secondary">Save</SubmitButton>
                </div>
              </form>
            </Card>
            <Card title="Stops & timings" padded={false}>
              <ol className="divide-y divide-line text-sm">
                {r.stops.map((s) => (
                  <li key={s.id} className="flex justify-between px-5 py-2.5">
                    <span>
                      {s.sequence}. {s.name}
                    </span>
                    <span className="tabular-nums text-muted">
                      Pickup {s.pickupTime} · Drop {s.dropTime}
                    </span>
                  </li>
                ))}
              </ol>
              <form action={addStopAction} className="grid gap-2 border-t border-line p-4 sm:grid-cols-5">
                <TenantFields slug={slug} back={back} />
                <input type="hidden" name="routeId" value={r.route.id} />
                <Input name="sequence" type="number" min={1} defaultValue={r.stops.length + 1} required aria-label="Order" />
                <Input name="name" placeholder="Stop name" required className="sm:col-span-2" aria-label="Stop" />
                <Input name="pickupTime" type="time" required aria-label="Pickup" />
                <Input name="dropTime" type="time" required aria-label="Drop" />
                <div className="sm:col-span-5">
                  <SubmitButton variant="secondary">Add stop</SubmitButton>
                </div>
              </form>
            </Card>
            <Card title={`Students on this route (${riders.length})`} padded={false}>
              <form action={assignTransportAction} className="grid gap-2 border-b border-line p-4 sm:grid-cols-4">
                <TenantFields slug={slug} back={back} />
                <input type="hidden" name="routeId" value={r.route.id} />
                <Input name="enrollmentNo" placeholder="Enrollment no." required className="uppercase sm:col-span-2" aria-label="Enrollment number" />
                <Select name="stopId" placeholder="Stop" options={r.stops.map((s) => ({ value: s.id, label: s.name }))} aria-label="Stop" />
                <SubmitButton>Assign</SubmitButton>
              </form>
              {riders.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No students assigned" />
                </div>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {riders.map((x) => (
                    <li key={x.studentId} className="flex items-center justify-between px-5 py-2">
                      <span>
                        <span className="font-mono text-xs">{x.enrollmentNo}</span> {x.fullName} <span className="text-muted">· {x.stop ?? "no stop"}</span>
                      </span>
                      <form action={removeTransportAction}>
                        <TenantFields slug={slug} back={back} />
                        <input type="hidden" name="studentId" value={x.studentId} />
                        <SubmitButton variant="ghost" className="px-2 py-1 text-xs text-danger">
                          Remove
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
