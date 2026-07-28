import { SignUp } from "@clerk/nextjs";
import { MarketingShell } from "@/components/marketing/MarketingShell";

export default function SignUpPage() {
  return (
    <MarketingShell>
      <div className="clerk-frame">
        <SignUp />
      </div>
    </MarketingShell>
  );
}
