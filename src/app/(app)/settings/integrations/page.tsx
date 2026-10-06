import { requirePageAdmin } from "@/server/session";
import { prisma } from "@/lib/prisma";
import { openSecret } from "@/lib/secretBox";
import { RAZORPAY_PROVIDER, maskKeyId } from "@/lib/integrations/razorpay";
import { RazorpayIntegrationCard } from "@/components/RazorpayIntegrationCard";
import { TagMangoIntegrationCard } from "@/components/settings/TagMangoIntegrationCard";
import { tagMangoStatus } from "@/lib/integrations/tagmango";
import { PageHeader } from "@/components/ui/PageHeader";
import { MailboxesCard } from "@/components/settings/MailboxesCard";
import { listMailAccounts } from "@/server/mailAccounts";
import { envSender } from "@/lib/mailer";

export default async function IntegrationsPage() {
  await requirePageAdmin();

  const [row, mailboxes, tagMango] = await Promise.all([
    prisma.integration.findUnique({ where: { provider: RAZORPAY_PROVIDER } }),
    listMailAccounts(),
    tagMangoStatus(),
  ]);
  const secretOpens = row?.secretEnc ? openSecret(row.secretEnc) !== null : false;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        description="Connect outside services. Each one stays off until it's turned on here."
      />
      <MailboxesCard initial={mailboxes} envFallback={envSender()?.email ?? null} />
      <RazorpayIntegrationCard
        initial={{
          enabled: row?.enabled ?? false,
          connected: Boolean(row?.enabled && row.keyId && secretOpens),
          hasKeys: Boolean(row?.keyId && row?.secretEnc),
          needsReentry: Boolean(row?.secretEnc && !secretOpens),
          keyId: maskKeyId(row?.keyId ?? null),
          mode: row?.keyId?.startsWith("rzp_test_") ? "test" : row?.keyId ? "live" : null,
          connectedAt: row?.connectedAt?.toISOString() ?? null,
        }}
      />
      <TagMangoIntegrationCard initial={tagMango} />
    </div>
  );
}
