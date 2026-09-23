import { redirect } from "next/navigation";

// The breadcrumb links "Settings" here; the first settings page is Businesses.
export default function SettingsIndex() {
  redirect("/settings/businesses");
}
