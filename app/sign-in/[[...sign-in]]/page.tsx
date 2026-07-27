import { SignIn } from "@clerk/nextjs";
import { PlaceShell } from "@/components/PlaceShell";

export default function SignInPage() {
  return (
    <PlaceShell title="Sign in">
      <div style={{ display: "grid", placeItems: "center", padding: "2rem 0" }}>
        <SignIn />
      </div>
    </PlaceShell>
  );
}
