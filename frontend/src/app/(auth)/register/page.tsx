import { siteConfig } from "@/config/site";
import { redirect } from "next/navigation";

export default function RegisterPage() {
  redirect(siteConfig.routes.signUp);
}
