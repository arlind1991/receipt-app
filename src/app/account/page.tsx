import { redirect } from "next/navigation";

// The account screen is now Settings.
export default function AccountPage() {
  redirect("/settings");
}
