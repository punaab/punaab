import { PlaceShell } from "@/components/PlaceShell";
import { LocationDoor } from "@/components/LocationDoor";
import { LOCATIONS } from "@/lib/locations";

export default function WorldHubPage() {
  return (
    <PlaceShell title="World Hub">
      <p className="hub-intro">
        You stand at the crossroads of PixelGrew. Each doorway is a place with
        one purpose — not a dashboard. Choose where to go.
      </p>
      <div className="location-grid">
        {LOCATIONS.map((location) => (
          <LocationDoor key={location.slug} location={location} />
        ))}
      </div>
    </PlaceShell>
  );
}
