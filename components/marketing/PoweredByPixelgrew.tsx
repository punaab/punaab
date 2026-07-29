import Image from "next/image";

const LOGO = "/assets/images/pixlegrew.webp";
const PIXELGREW_URL =
  "https://discord.com/servers/pixelgrew-1150040799569002586";

/**
 * Compact “POWERED BY PIXELGREW” mark — logo + label.
 */
export function PoweredByPixelgrew({
  className = "",
}: {
  className?: string;
}) {
  return (
    <a
      href={PIXELGREW_URL}
      className={`pixelgrew-credit${className ? ` ${className}` : ""}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Powered by Pixelgrew — join the PixelGrew Discord"
    >
      <Image
        src={LOGO}
        alt=""
        width={28}
        height={28}
        className="pixelgrew-credit-logo"
      />
      <span className="pixelgrew-credit-text">
        <span className="pixelgrew-credit-powered">Powered by</span>
        <span className="pixelgrew-credit-name">Pixelgrew</span>
      </span>
    </a>
  );
}
