import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Create account · KeepStat" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/app");
  return <AuthForm mode="signup" />;
}
