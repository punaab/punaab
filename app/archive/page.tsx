import { PlaceShell } from "@/components/PlaceShell";
import { SEED_BOOKS } from "@/lib/seed-data";

export default function ArchivePage() {
  return (
    <PlaceShell title="The Archive">
      <p className="hub-intro">
        Shelves of memory. Books move from personal journals to universal canon
        only through reputation and council review.
      </p>
      <div className="panel-grid">
        {SEED_BOOKS.map((book) => (
          <article key={book.id} className="panel">
            <p className="meta">{book.status.replaceAll("_", " ")}</p>
            <h2>{book.title}</h2>
            <p>{book.summary}</p>
            <p className="meta">by {book.author_name}</p>
          </article>
        ))}
      </div>
    </PlaceShell>
  );
}
