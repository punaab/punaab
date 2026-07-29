const NOTEBOOK_URL =
  "https://pixelgrew.myshopify.com/products/the-traveling-bards-notebook?utm_source=copyToPasteBoard&utm_medium=product-links&utm_content=web";

/**
 * Traveling Bard notebook promo — sits in the homepage hero in place of the 3D stage.
 */
export function NotebookMerch({
  className = "",
}: {
  className?: string;
}) {
  return (
    <aside
      className={`notebook-merch${className ? ` ${className}` : ""}`}
      aria-label="The Traveling Bard's Notebook"
    >
      <div className="notebook-merch-glow" aria-hidden="true" />
      <div className="notebook-merch-stars" aria-hidden="true" />
      <div className="notebook-merch-frame" aria-hidden="true" />

      <p className="notebook-merch-kicker">Merch</p>
      <div className="notebook-merch-spotlight">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/images/notebook_preview.svg"
          alt="The Traveling Bard's Notebook"
          className="notebook-merch-art"
          width={320}
          height={400}
        />
      </div>
      <div className="notebook-merch-copy">
        <h3>The Traveling Bard&apos;s Notebook</h3>
        <p>
          Matte hardcover journal for road notes, sketches, and scraps of lore
          — 150 lined pages.
        </p>
        <a
          className="btn primary btn-glow"
          href={NOTEBOOK_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Get the notebook
        </a>
      </div>
    </aside>
  );
}
