import { requirePageAdmin } from "@/server/session";
import { BusinessProfileForm } from "@/components/settings/BusinessProfileForm";
import { ENTITY_OPTIONS } from "@/components/settings/entities";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";

export default async function NewBusinessPage() {
  await requirePageAdmin();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Settings · Businesses"
        title="New business"
        description="Once it exists, connect its Google Sheet and add its categories, gateways and team from its page."
      />
      <Card>
        <CardBody>
          <BusinessProfileForm
            entities={ENTITY_OPTIONS}
            initial={{
              name: "",
              slug: "",
              entity: "GRATEFUL",
              color: "#6a6cf0",
              invoicePrefix: "INV-",
              invoiceNextNumber: 1,
              defaultGstPercent: 18,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
