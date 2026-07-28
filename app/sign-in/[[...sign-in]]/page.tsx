import { SignIn } from "@clerk/nextjs";
import { MarketingShell } from "@/components/marketing/MarketingShell";

export default function SignInPage() {
  return (
    <MarketingShell>
      <div className="clerk-frame">
        <SignIn />
      </div>
    </MarketingShell>
  );
}
