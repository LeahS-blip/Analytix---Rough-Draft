import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Sign in · Analytix" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/app");
  return <AuthForm mode="login" />;
}
