import Image from "next/image";

const LOGO = "/assets/images/pixlegrew.webp";

/**
 * Compact “POWERED BY PIXELGREW” mark — logo + label.
 */
export function PoweredByPixelgrew({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`pixelgrew-credit${className ? ` ${className}` : ""}`}
      aria-label="Powered by Pixelgrew"
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
    </div>
  );
}
