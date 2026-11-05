import { AuthForm } from "@/components/AuthForm";
import { usePageMeta } from "@/hooks/use-page-meta";

export default function SignIn() {
  usePageMeta({
    title: "Sign in — Flight Price Notifier",
    description: "Sign in to Flight Price Notifier to manage your fare alerts.",
    ogTitle: "Sign in — Flight Price Notifier",
    ogDescription: "Sign in to manage your fare alerts.",
  });
  return <AuthForm mode="signin" />;
}
