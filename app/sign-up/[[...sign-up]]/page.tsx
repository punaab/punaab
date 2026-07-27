import { SignUp } from "@clerk/nextjs";
import { PlaceShell } from "@/components/PlaceShell";

export default function SignUpPage() {
  return (
    <PlaceShell title="Create account">
      <div style={{ display: "grid", placeItems: "center", padding: "2rem 0" }}>
        <SignUp />
      </div>
    </PlaceShell>
  );
}
