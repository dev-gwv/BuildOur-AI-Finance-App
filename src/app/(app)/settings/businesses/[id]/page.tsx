import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Building2, CreditCard, Landmark, Sheet, Tag, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageAdmin } from "@/server/session";
import { sheetSource } from "@/server/businesses";
import { BusinessProfileForm } from "@/components/settings/BusinessProfileForm";
import { SheetConnectionForm } from "@/components/settings/SheetConnectionForm";
import { GstLockForm } from "@/components/settings/GstLockForm";
import { CategoriesEditor, GatewaysEditor } from "@/components/settings/CatalogEditors";
import { MembersEditor } from "@/components/settings/MembersEditor";
import { ArchiveButton, MarkReviewedButton } from "@/components/settings/BusinessActions";
import { ENTITY_OPTIONS, entityName } from "@/components/settings/entities";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const LEGACY_ENV: Record<string, string> = {
  mulberry: "SHEETS_WEBHOOK_URL",
  ipc: "SHEETS_WEBHOOK_URL_IPC",
  iwc: "SHEETS_WEBHOOK_URL_IWC",
};

function Section({
  id,
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  id: string;
  icon: typeof Building2;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <CardTitle
          title={
            <span className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-neutral-500" />
              {title}
            </span>
          }
          subtitle={subtitle}
        />
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

export default async function BusinessSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAdmin();
  const { id } = await params;

  const [business, users] = await Promise.all([
    prisma.business.findUnique({
      where: { id },
      include: {
        categories: { orderBy: { name: "asc" }, include: { _count: { select: { expenses: true } } } },
        gateways: { orderBy: { name: "asc" } },
        members: { select: { userId: true } },
        _count: { select: { invoices: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: "MEMBER" },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, active: true },
    }),
  ]);
  if (!business) notFound();

  const source = sheetSource(business);
  const archived = Boolean(business.archivedAt);

  return (
    <div className="space-y-6">
      <Link
        href="/settings/businesses"
        className="inline-flex min-h-10 items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All businesses
      </Link>

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: business.color }} />
            {entityName(business.entity)}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {business.name}
            {archived && <Badge>Archived</Badge>}
          </span>
        }
        description={`${business._count.invoices} invoice${business._count.invoices === 1 ? "" : "s"} · ${business.members.length} member${business.members.length === 1 ? "" : "s"} · /${business.slug}`}
        actions={
          <>
            {business.needsReview && <MarkReviewedButton businessId={business.id} />}
            <ArchiveButton businessId={business.id} archived={archived} name={business.name} />
          </>
        }
      />

      {business.needsReview && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This business was set up automatically when the app was upgraded. Check that it bills as the right entity, that
            its invoice series continues from the last number you issued, and connect its sheet — then mark it as reviewed.
          </p>
        </div>
      )}

      <nav className="flex flex-wrap gap-1.5 text-xs font-medium">
        {[
          ["profile", "Profile & numbering"],
          ...(business.entity === "GRATEFUL" ? [["gst", "GST filing lock"]] : []),
          ["sheet", "Google Sheet"],
          ["categories", "Categories"],
          ["gateways", "Gateways"],
          ["members", "Members"],
        ].map(([anchor, label]) => (
          <a
            key={anchor}
            href={`#${anchor}`}
            className="flex min-h-9 items-center rounded-lg border border-neutral-200/80 bg-white px-3 text-neutral-700 shadow-card hover:text-neutral-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300"
          >
            {label}
          </a>
        ))}
      </nav>

      <Section id="profile" icon={Building2} title="Profile & numbering" subtitle="Who it is, who bills for it, how its invoices and credit notes are numbered">
        <BusinessProfileForm
          entities={ENTITY_OPTIONS}
          hasInvoices={business._count.invoices > 0}
          initial={{
            id: business.id,
            name: business.name,
            slug: business.slug,
            entity: business.entity,
            color: business.color,
            invoicePrefix: business.invoicePrefix,
            invoiceNextNumber: business.invoiceNextNumber,
            invoiceDigits: business.invoiceDigits,
            creditNotePrefix: business.creditNotePrefix,
            defaultGstPercent: business.defaultGstPercent,
          }}
        />
      </Section>

      {/* Only a GST-registered seller files returns. */}
      {business.entity === "GRATEFUL" && (
        <Section id="gst" icon={Landmark} title="GST filing lock" subtitle="Freeze months whose GST return is already filed">
          <GstLockForm
            businessId={business.id}
            lockedThrough={business.gstLockedThrough ? business.gstLockedThrough.toISOString().slice(0, 10) : null}
          />
        </Section>
      )}

      <Section id="sheet" icon={Sheet} title="Google Sheet" subtitle="Payments and entries are written here as they're saved">
        <SheetConnectionForm
          businessId={business.id}
          sheetUrl={business.sheetUrl}
          source={source}
          envVar={LEGACY_ENV[business.slug] ?? null}
        />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section id="categories" icon={Tag} title="Categories" subtitle="For money in & out entries">
          <CategoriesEditor
            businessId={business.id}
            categories={business.categories.map((c) => ({ id: c.id, name: c.name, entries: c._count.expenses }))}
          />
        </Section>
        <Section id="gateways" icon={CreditCard} title="Payment gateways" subtitle="The % each processor keeps from money in">
          <GatewaysEditor businessId={business.id} gateways={business.gateways} />
        </Section>
      </div>

      <Section id="members" icon={Users} title="Members" subtitle="Team members who can see and work in this business">
        <MembersEditor
          businessId={business.id}
          users={users}
          memberIds={business.members.map((m) => m.userId)}
        />
      </Section>
    </div>
  );
}
