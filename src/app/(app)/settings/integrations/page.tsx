import { requirePageAdmin } from "@/server/session";
import { razorpayStatus } from "@/lib/integrations/razorpay";
import { RazorpayIntegrationCard } from "@/components/RazorpayIntegrationCard";
import { TagMangoIntegrationCard } from "@/components/settings/TagMangoIntegrationCard";
import { tagMangoStatus } from "@/lib/integrations/tagmango";
import { PageHeader } from "@/components/ui/PageHeader";
import { MailboxesCard } from "@/components/settings/MailboxesCard";
import { listMailAccounts } from "@/server/mailAccounts";
import { envSender } from "@/lib/mailer";

export default async function IntegrationsPage() {
  await requirePageAdmin();

  const [razorpay, mailboxes, tagMango] = await Promise.all([razorpayStatus(), listMailAccounts(), tagMangoStatus()]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        description="Connect outside services. Each one stays off until it's turned on here."
      />
      <MailboxesCard initial={mailboxes} envFallback={envSender()?.email ?? null} />
      <RazorpayIntegrationCard initial={razorpay} />
      <TagMangoIntegrationCard initial={tagMango} />
    </div>
  );
}
