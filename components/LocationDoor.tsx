import Link from "next/link";
import type { Location } from "@/lib/locations";

export function LocationDoor({ location }: { location: Location }) {
  return (
    <Link
      href={location.href}
      className="location-door"
      style={{ ["--accent" as string]: location.accent }}
    >
      <div className="door-frame">
        <p className="door-kicker">{location.tagline}</p>
        <h2>{location.name}</h2>
        <p className="door-desc">{location.description}</p>
        <span className="door-enter">
          {location.guestAllowed ? "Enter" : "Enter · account"}
        </span>
      </div>
    </Link>
  );
}
