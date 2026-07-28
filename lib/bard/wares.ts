/**
 * What Punaab carries, and what he will part with.
 *
 * He is not a shopkeeper. He is a man with a pack, and the pack changes shape
 * depending on where he has just been: salt on the strand, grafting wax out of
 * the orchards, a whetstone he took in trade for a song at the quarry. So a
 * ware is not simply "in stock" — it has a `tag`, and a tag is a *place*. The
 * tag matches `Destination.waresTag`, so asking him what he has for sale at
 * Cidergarth gets you apples and asking him on the Hollowmoor gets you peat.
 *
 * Wares tagged `"*"` are the standing stock: the things he never runs out of
 * because he cannot afford to. They are offered everywhere.
 *
 * `waresFor(tag)` answers "what does a place like this sell", which is what a
 * shop screen wants. `packAfter(trail)` answers the better question — what is
 * on him *now*, given where he has been — and it is the one that makes him a
 * trader rather than a vending machine: he buys salt at the strand and is still
 * selling it four stops inland, he comes off the quarry with ore in the bottom
 * of the pack, and the coast follows him into the hills for an hour. See
 * `PACK_MEMORY` and `restockAt`.
 *
 * -------------------------------------------------------------------------
 * FOR GAME DEVELOPERS: replacing this catalogue
 * -------------------------------------------------------------------------
 * Everything in `DEFAULT_WARES` is a *default*. It exists so that a project
 * with an empty database still ships a bard who has something in his pack.
 * The moment you put rows in the `items` table for your project, they are
 * merged over these by `resolveWares()` and served from `GET /api/v1/merchant`
 * and the other v1 content routes.
 *
 *   1. REPLACE ONE ITEM — insert an `items` row whose `name` matches a default
 *      (case- and punctuation-insensitive; "Road Bread" == "road-bread"). Your
 *      description, price, category and icon win. The default's `tag` is kept,
 *      so your item shows up in the same places his did.
 *
 *   2. ADD A NEW ITEM — insert an `items` row with a name that matches nothing.
 *      It joins the catalogue tagged `"*"`, i.e. carried everywhere. To pin it
 *      to one kind of place instead, write the category as `tag/category`:
 *
 *          name:     "Ferryman's Token"
 *          category: "fen/curio"
 *
 *      and it will only be offered at destinations whose `waresTag` is `fen`.
 *      The tags in `WARE_TAGS` are the ones the default world uses; any string
 *      works if you also author your own destinations.
 *
 *   3. THROW THE LOT AWAY — `resolveWares(rows, { mode: "replace" })` ignores
 *      the defaults entirely and serves only your rows. Use it when your game
 *      is not set in this valley and Punaab is just visiting.
 *
 * Nothing here reads the database itself; the route handlers do that and pass
 * the rows in. That keeps this file importable from a client component, from a
 * route handler, and from a test, without a Supabase client in sight.
 */

// ---------------------------------------------------------------------------
// Shared override plumbing
// ---------------------------------------------------------------------------
//
// `lore.ts` and `quests.ts` import these two helpers from here rather than each
// keeping a subtly different copy. This module is the one of the three content
// files with no dependencies of its own, so it is the honest place to put them.

/**
 * A union that still accepts anything.
 *
 * The literals are the vocabulary of the default world and give a developer
 * autocomplete; the second arm keeps the door open, because a project's
 * `items.category` column is free text and its author owes us nothing.
 * `Record<never, never>` rather than `{}` — same effect, no lint fight.
 */
export type Loose<T extends string> = T | (string & Record<never, never>);

/** Loose key for matching a project row against a default. */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Directive names the content modules understand. */
export const DIRECTIVE_KEYS = [
  "location",
  "region",
  "tags",
  "giver",
  "coin",
  "item",
  "song",
  "lore",
  "reward",
  "steps",
  "repeatable",
] as const;

/**
 * Leading `key: value` lines on an override, stopped by a blank line or a `---`
 * fence, and stripped from the body that comes back.
 *
 * The `lore_docs` and `quests` tables are two text columns and a title — there
 * is nowhere to hang "which place unlocks this" or "what is the reward". Rather
 * than demand a migration from every customer, an override can declare that in
 * a couple of lines at the top of the body, which is a convention a writer can
 * follow in a CMS textarea without being told twice.
 *
 * The block only opens if the *first* line is a recognised directive or a `---`
 * fence. That rule is load-bearing: without it a perfectly innocent entry that
 * begins "Note: the road floods in spring" has its first line silently eaten,
 * which is a data-loss bug in a customer's own writing and would be reported as
 * "the API truncates my lore". Once the block is open, any `key: value` line is
 * absorbed — including keys we do not know — so a project can carry its own
 * bookkeeping through untouched.
 */
export function parseDirectives(
  raw: string,
  known: readonly string[] = DIRECTIVE_KEYS
): {
  meta: Record<string, string>;
  body: string;
} {
  const meta: Record<string, string> = {};
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/;
  let cursor = 0;

  // An opening `---` fence is optional; it just makes the block obvious, and it
  // is the escape hatch for a first directive we have never heard of.
  const fenced = lines[0]?.trim() === "---";
  if (fenced) cursor = 1;
  else {
    const head = KEY_LINE.exec(lines[0] ?? "");
    if (!head || !known.includes(head[1].toLowerCase())) {
      return { meta, body: raw.trim() };
    }
  }

  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor];
    if (line.trim() === "") break;
    if (line.trim() === "---") {
      cursor++;
      break;
    }
    const match = KEY_LINE.exec(line);
    if (!match) break;
    meta[match[1].toLowerCase()] = match[2].trim();
  }

  // A `---` fence with nothing under it is not a directive block.
  if (Object.keys(meta).length === 0) return { meta, body: raw.trim() };

  return { meta, body: lines.slice(cursor).join("\n").trim() };
}

/** `a | b | c` -> `["a", "b", "c"]`. Empty segments dropped. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** How a resolved record got here. Useful for a "customised" badge in a UI. */
export type Origin = "default" | "project";

export type ResolveOptions = {
  /**
   * `merge` (default) lays project rows over the defaults.
   * `replace` serves only the project's rows — for games set somewhere else.
   */
  mode?: "merge" | "replace";
};

// ---------------------------------------------------------------------------
// Wares
// ---------------------------------------------------------------------------

/** The shelf a ware sits on. Cosmetic — group by it in a shop UI. */
export type WareCategory =
  | "provisions"
  | "remedy"
  | "tool"
  | "craft"
  | "curio"
  | "music"
  | "charm"
  | "service";

/** Where he is when he has it. `"*"` means always. */
export type WareTag =
  | "*"
  | "farm"
  | "shore"
  | "orchard"
  | "wood"
  | "fen"
  | "stone"
  | "heights"
  | "moor"
  | "curio"
  | "market"
  | "priory";

export type Ware = {
  id: string;
  name: string;
  description: string;
  /** In coppers. He deals in coppers; anything dearer he would rather barter. */
  price: number;
  category: Loose<WareCategory>;
  /** Matches `Destination.waresTag`. `"*"` is carried everywhere. */
  tag: Loose<WareTag>;
  iconUrl?: string;
  origin?: Origin;
  /** `items.id` of the row this came from, when it came from a project. */
  rowId?: string;
};

export const WARE_TAGS: readonly WareTag[] = [
  "*",
  "farm",
  "shore",
  "orchard",
  "wood",
  "fen",
  "stone",
  "heights",
  "moor",
  "curio",
  "market",
  "priory",
];

/**
 * The standing stock and eleven packs' worth of local goods.
 *
 * Prices are deliberately small and mean something: two coppers is a loaf,
 * twenty-five is a month of eating. He prices the useless things high and the
 * necessary things low, which is either generosity or a very slow con.
 */
export const DEFAULT_WARES: Ware[] = [
  // --- Always in the pack ------------------------------------------------
  {
    id: "road-bread",
    name: "Road Bread",
    description:
      "Twice-baked, keeps a fortnight, tastes like it. You will be glad of it on the fourth day and only then.",
    price: 2,
    category: "provisions",
    tag: "*",
  },
  {
    id: "ballad-copied-out",
    name: "A Ballad, Copied Out",
    description:
      "Words and the shape of the tune, in his hand, on paper he did not steal. Cheaper than learning it off him twice.",
    price: 6,
    category: "music",
    tag: "*",
  },
  {
    id: "lute-string",
    name: "Spare Lute String",
    description:
      "Gut, wound and waxed. He carries five and has never once had five when he needed them.",
    price: 5,
    category: "music",
    tag: "*",
  },
  {
    id: "long-candle",
    name: "Tallow Candle, Long",
    description:
      "Burns nine hours, smells like a kitchen. Long enough to read by, or to sit up with somebody.",
    price: 3,
    category: "provisions",
    tag: "*",
  },
  {
    id: "mostly-right-map",
    name: "A Map That Is Mostly Right",
    description:
      "Drawn from memory over four winters. The roads are true. The distances are hopeful.",
    price: 14,
    category: "tool",
    tag: "*",
  },
  {
    id: "needle-and-thread",
    name: "Needle and Waxed Thread",
    description:
      "For your pack, your boots, and eventually you. He will do the stitching for a copper more.",
    price: 4,
    category: "tool",
    tag: "*",
  },
  {
    id: "rosin",
    name: "A Thumbnail of Rosin",
    description:
      "Pine sap boiled hard. Good for strings, good for grip, and it makes a fire catch in the wet.",
    price: 2,
    category: "craft",
    tag: "*",
  },
  {
    id: "letter-carried",
    name: "A Letter Carried",
    description:
      "He is going that way regardless. It arrives when it arrives, and he will not read it, and he will tell you truthfully if he could not find them.",
    price: 8,
    category: "service",
    tag: "*",
  },

  // --- Barleyhearth and the field country ---------------------------------
  {
    id: "seed-corn",
    name: "Barleyhearth Seed Corn",
    description:
      "A pint of good barley out of a field with a name older than the village. It will grow anywhere. It will not taste the same anywhere.",
    price: 9,
    category: "craft",
    tag: "farm",
  },
  {
    id: "byre-rope",
    name: "Byre Rope",
    description:
      "Twelve feet of horsehair rope, plaited by somebody's grandmother, who watched him buy it and did not approve.",
    price: 6,
    category: "tool",
    tag: "farm",
  },
  {
    id: "hedging-bill",
    name: "Hedging Bill",
    description:
      "A hooked blade on a short haft, for laying a hedge so it grows back thicker. Cruelty in service of shelter — the whole valley in one tool.",
    price: 22,
    category: "tool",
    tag: "farm",
  },
  {
    id: "old-cheese",
    name: "A Small Cheese, Very Old",
    description:
      "Hard as a knuckle and twice as sharp. Shave it, do not bite it. He learned that with a tooth.",
    price: 7,
    category: "provisions",
    tag: "farm",
  },
  {
    id: "winter-onions",
    name: "Winter Onions, Plaited",
    description:
      "A rope of eight, plaited by somebody who has done it ten thousand times and would be insulted to be praised for it. They keep till March and then they keep being onions.",
    price: 4,
    category: "provisions",
    tag: "farm",
  },

  // --- Saltmere and the strand --------------------------------------------
  {
    id: "mere-salt",
    name: "Mere Salt, Ground",
    description:
      "Scraped off the west rocks after a hard blow. Nobody can explain where a landlocked water gets salt, and the strand has stopped asking.",
    price: 4,
    category: "provisions",
    tag: "shore",
  },
  {
    id: "cork-float",
    name: "Net Float, Cork",
    description:
      "Painted with a fisher's mark so the mere knows whose net it is. The mere has never returned one.",
    price: 3,
    category: "craft",
    tag: "shore",
  },
  {
    id: "blunted-glass",
    name: "Glass Worn Blunt",
    description:
      "Green, thumbnail-sized, ground soft by forty years of water. It was a bottle. Somebody was celebrating.",
    price: 5,
    category: "curio",
    tag: "shore",
  },
  {
    id: "smoked-char",
    name: "Smoked Char",
    description:
      "Split, salted, hung a week in alder smoke. Eat it cold and do not apologise for the smell.",
    price: 6,
    category: "provisions",
    tag: "shore",
  },
  {
    id: "wreck-nail",
    name: "A Nail from the Ninefoot",
    description:
      "Square-cut, half eaten by the mere, still perfectly capable of holding two boards together. It was in a boat for longer than you have been alive.",
    price: 4,
    category: "curio",
    tag: "shore",
  },
  {
    id: "net-lead",
    name: "Net Lead, Cast",
    description:
      "Poured into a scoop in the sand and pinched onto the footrope while still warm. Every one on the quay is a different shape and every fisher knows their own by feel in the dark.",
    price: 3,
    category: "craft",
    tag: "shore",
  },

  // --- Cidergarth and the orchards ----------------------------------------
  {
    id: "cidergarth-blackjack",
    name: "Cidergarth Blackjack",
    description:
      "A leather bottle of the strong dark cider. One measure settles an argument. Two starts a better one.",
    price: 11,
    category: "provisions",
    tag: "orchard",
  },
  {
    id: "grafting-wax",
    name: "Grafting Wax",
    description:
      "Beeswax, tallow and resin. You bind a living cut with it and the tree forgets it was ever two trees.",
    price: 4,
    category: "craft",
    tag: "orchard",
  },
  {
    id: "apple-cutting",
    name: "Apple Cutting, Wrapped",
    description:
      "A finger of last year's wood off the old mother tree, packed in damp moss. Get it in the ground before it wakes and you have an orchard in nine years.",
    price: 15,
    category: "craft",
    tag: "orchard",
  },
  {
    id: "windfall-vinegar",
    name: "Windfall Vinegar",
    description:
      "What happens to cider left alone. Cleans a wound, ruins a mood, keeps forever.",
    price: 5,
    category: "remedy",
    tag: "orchard",
  },
  {
    id: "garth-honey",
    name: "Garth Honey, Light",
    description:
      "Off the orchard hives, pale as cider and tasting faintly of the blossom it came out of. The bees that made it have been told who died this year. That is not on the label.",
    price: 9,
    category: "provisions",
    tag: "orchard",
  },
  {
    id: "apple-leather",
    name: "Apple Leather",
    description:
      "Windfalls boiled to a paste, spread on a board and dried in the loft over a winter. It is sweet, it is leather, and it will still be sweet leather in two years.",
    price: 3,
    category: "provisions",
    tag: "orchard",
  },

  // --- Elderloom, Greyneedle, Bracken Hollow -------------------------------
  {
    id: "elder-whistle",
    name: "Elder Whistle",
    description:
      "Pith pushed out of an elder stem, one note, very loud. For finding each other in a wood that does not want you to.",
    price: 6,
    category: "music",
    tag: "wood",
  },
  {
    id: "ash-staff",
    name: "Ash Walking Staff",
    description:
      "Shoulder height, seasoned two years. It will not save you from anything, but it will let you look at a drop without your knees joining the conversation.",
    price: 12,
    category: "tool",
    tag: "wood",
  },
  {
    id: "oak-gall-ink",
    name: "Ink of Oak Gall",
    description:
      "Black going to brown by the time you are old. Everything anyone has written about this valley was written in this.",
    price: 8,
    category: "craft",
    tag: "wood",
  },
  {
    id: "dry-kindling",
    name: "Bundle of Kindling, Dry",
    description:
      "Split fine and kept under the flap of his pack, where his spare shirt should be. He has made that choice deliberately and more than once.",
    price: 2,
    category: "provisions",
    tag: "wood",
  },
  {
    id: "charcoal-half-peck",
    name: "Charcoal, Half a Peck",
    description:
      "A week of somebody not sleeping, in a bag. It burns hotter than wood and it burns clean, and every nail in this valley was made over it.",
    price: 4,
    category: "craft",
    tag: "wood",
  },

  // --- Thornwake Fen -------------------------------------------------------
  {
    id: "fen-lamp-oil",
    name: "Fen Lamp Oil",
    description:
      "Rendered thin so it burns in cold air. A flask lights the causeway markers end to end, if you are quick and you do not stop to look at anything.",
    price: 9,
    category: "provisions",
    tag: "fen",
  },
  {
    id: "bog-myrtle",
    name: "Bog Myrtle Against Flies",
    description:
      "A crushed sprig behind each ear. It works, which is the only kind thing the fen has ever done for anybody.",
    price: 4,
    category: "remedy",
    tag: "fen",
  },
  {
    id: "sedge-rope",
    name: "Sedge Rope",
    description:
      "Twisted from fen grass, forty feet, light as nothing. It will hold a man out of the peat exactly once.",
    price: 6,
    category: "tool",
    tag: "fen",
  },
  {
    id: "bog-butter",
    name: "Preserved Bog Butter",
    description:
      "Buried in a pail before anybody now living was born, and still, technically, butter. He does not recommend it. He does keep offering it.",
    price: 12,
    category: "curio",
    tag: "fen",
  },
  {
    id: "punt-ferrule",
    name: "Punt-Pole Ferrule",
    description:
      "The iron shoe off the working end of a pole, splayed so it does not bury itself in peat. Fit it to your own stick and the fen becomes a floor you can push against.",
    price: 7,
    category: "tool",
    tag: "fen",
  },
  {
    id: "cut-reed",
    name: "A Bundle of Cut Reed",
    description:
      "Winter-cut, standing-dried, tied at the butt. Enough for a small roof or a very long argument with a thatcher about whose fault the last one was.",
    price: 3,
    category: "craft",
    tag: "fen",
  },

  // --- Ashenreach and the red quarry --------------------------------------
  {
    id: "red-ochre",
    name: "Red Ochre, A Twist",
    description:
      "Ground terrace stone in a paper screw. Paint a mark with it and the weather takes a hundred years to argue.",
    price: 3,
    category: "craft",
    tag: "stone",
  },
  {
    id: "ashenreach-whetstone",
    name: "Whetstone, Ashenreach Grit",
    description:
      "Coarse one face, fine the other. It puts an edge on a blade in the time it takes to hum something through twice.",
    price: 7,
    category: "tool",
    tag: "stone",
  },
  {
    id: "fossil-shell",
    name: "Fossil Shell",
    description:
      "A sea creature in dry red rock, two hundred miles from any sea, four hundred feet up. He has three theories and believes none of them.",
    price: 9,
    category: "curio",
    tag: "stone",
  },
  {
    id: "iron-nails",
    name: "Iron Nails, A Dozen",
    description:
      "Square-cut, quarry forge. Worth more than they look, as anyone who has tried to fix a roof without one will tell you at length.",
    price: 6,
    category: "craft",
    tag: "stone",
  },
  {
    id: "delve-ore",
    name: "Delve Ore, A Lump",
    description:
      "Heavy, blue-black in the break, and it will not weld — four hammers at Wealdmoot say so. Sold as a curiosity by men who would much rather be selling it as iron.",
    price: 8,
    category: "curio",
    tag: "stone",
  },
  {
    id: "quicklime",
    name: "Quicklime, A Twist",
    description:
      "Burnt out of the pale stone at the kiln east of the delve. Keep it dry, keep it off your hands, and it will make a mortar that outlasts the wall you put it in.",
    price: 4,
    category: "craft",
    tag: "stone",
  },

  // --- Skarnfell and the Kestrel March -------------------------------------
  {
    id: "snowmelt-flask",
    name: "Snowmelt, Stoppered",
    description:
      "Taken at the spring where the Sildwater starts, which is a crack in a rock the size of your hand. Every river in the valley is that, first.",
    price: 5,
    category: "curio",
    tag: "heights",
  },
  {
    id: "hobnails",
    name: "Hobnails",
    description:
      "A palmful, and the punch to set them. Wet rock stops being an opinion and becomes a floor.",
    price: 8,
    category: "tool",
    tag: "heights",
  },
  {
    id: "skarnfell-cap",
    name: "Wool Cap, Skarnfell",
    description:
      "Undyed, unwashed, still full of the grease the sheep put there. Rain runs off it. So does most conversation about how it looks.",
    price: 13,
    category: "provisions",
    tag: "heights",
  },
  {
    id: "kestrel-feather",
    name: "Kestrel Feather",
    description:
      "Found, not taken — he wants that understood. Trims a quill, or a hat, or nothing at all.",
    price: 4,
    category: "curio",
    tag: "heights",
  },
  {
    id: "pass-tally",
    name: "Snow Gate Tally",
    description:
      "A notched stick from the last cottage: one notch for every week the pass was shut, one year to a stick. She gives them away and she has never once been asked for one.",
    price: 3,
    category: "curio",
    tag: "heights",
  },

  // --- The Hollowmoor ------------------------------------------------------
  {
    id: "heather-honey",
    name: "Heather Honey",
    description:
      "Dark, thick, tastes faintly of smoke. It will not pour; you cut it with a knife and you are glad to.",
    price: 10,
    category: "provisions",
    tag: "moor",
  },
  {
    id: "peat-brick",
    name: "Peat Brick",
    description:
      "Cut, stacked and dried a summer. Burns low and long and puts the smell of the moor into everything you own.",
    price: 2,
    category: "provisions",
    tag: "moor",
  },
  {
    id: "cotton-wick",
    name: "Moor-Cotton Wick",
    description:
      "Bog cotton twisted with a thread of flax. Burns clean in a lamp with no glass, which up there is the only kind there is.",
    price: 3,
    category: "craft",
    tag: "moor",
  },
  {
    id: "rowan-charm",
    name: "Charm of Rowan and Red Thread",
    description:
      "Two twigs and a knot, made by a woman on the moor who does not charge for them and objects to him selling them. He gives her the coppers on the way back.",
    price: 6,
    category: "charm",
    tag: "moor",
  },
  {
    id: "sweetwell-water",
    name: "Sweetwell Water, Stoppered",
    description:
      "Cold, hard, tasting of iron, out of the one spring on four miles of sour moor. It does nothing for you. Everybody on that moor would still rather drink it than anything else.",
    price: 3,
    category: "remedy",
    tag: "moor",
  },
  {
    id: "bog-oak",
    name: "Bog Oak, A Splinter",
    description:
      "Black as the peat that kept it, hard enough to turn a knife, and older than every building in this valley put together. It came out of a cutting face eight feet down.",
    price: 6,
    category: "curio",
    tag: "moor",
  },

  // --- Ruins, circles and things he should probably have left alone --------
  {
    id: "key-to-nothing",
    name: "A Key to a Door That Is Gone",
    description:
      "Iron, heavy, warded for a lock in a wall that fell before the wall was old. It opens nothing. It is still a key.",
    price: 18,
    category: "curio",
    tag: "curio",
  },
  {
    id: "hold-coin",
    name: "Coin of the Hold",
    description:
      "A face worn to a suggestion, and lettering nobody local can read. It spends, if you find someone who does not look closely.",
    price: 25,
    category: "curio",
    tag: "curio",
  },
  {
    id: "circle-pebbles",
    name: "Nine Pebbles from the Circle",
    description:
      "Gathered at the stones, one for each. He counted them out for you. He counts them again most nights.",
    price: 7,
    category: "charm",
    tag: "curio",
  },
  {
    id: "stone-rubbing",
    name: "Rubbing of a Stone Face",
    description:
      "Charcoal on thin paper, taken off the tallest of the nine. It is either a face or it is weather, and the argument has outlived everyone who started it.",
    price: 12,
    category: "curio",
    tag: "curio",
  },
  {
    id: "burnt-beam",
    name: "A Hand's Width of Burnt Beam",
    description:
      "Oak, charred through on one face and sound on the other, off a farm that burned thirty years ago and was never rebuilt. He will sell it. He will not tell you the story with it.",
    price: 5,
    category: "curio",
    tag: "curio",
  },
  {
    id: "hallowfield-buckle",
    name: "A Buckle Off Hallowfield",
    description:
      "Bronze, a thumb across, turned up by a plough on a field named for the dead. Nobody can date it and nobody can say whose it was, and that is most of what it is worth.",
    price: 14,
    category: "curio",
    tag: "curio",
  },
  {
    id: "last-tree-cloth",
    name: "A Strip Off the Last Tree",
    description:
      "Cloth from the knot on the final pine in the Tarnwild, weathered to no colour at all. He did not take it. It came away in his hand and he has never been comfortable about that.",
    price: 8,
    category: "charm",
    tag: "curio",
  },

  // --- The Wealdmoot market ------------------------------------------------
  {
    id: "wealdmoot-ale",
    name: "Wealdmoot Ale, Small",
    description:
      "Thin, sour, safer than the water, and the only drink in the valley you are permitted to be seen buying before noon. Two of these are one of anything else.",
    price: 3,
    category: "provisions",
    tag: "market",
  },
  {
    id: "tally-stick",
    name: "A Tally Stick, Split",
    description:
      "Notched across, then split down the grain, and the two halves only ever fit each other. Half the debts in this valley are held together by a piece of hazel and no signature at all.",
    price: 4,
    category: "tool",
    tag: "market",
  },
  {
    id: "worn-boots",
    name: "Boots, Already Broken In",
    description:
      "Somebody else's, resoled twice, and there is no politer way to say why they are for sale. They will not blister you, which at this price is the entire argument.",
    price: 20,
    category: "tool",
    tag: "market",
  },
  {
    id: "market-hand",
    name: "A Hand at the Market",
    description:
      "He will read your letter to you, or write one back, in a corner with his shoulder turned so that nobody else hears it. He does more of this than he does singing and he charges less for it.",
    price: 3,
    category: "service",
    tag: "market",
  },

  // --- Greyneedle Priory ---------------------------------------------------
  {
    id: "nine-herb-physic",
    name: "Physic of Nine Herbs",
    description:
      "Made up by the infirmarer, who will tell you all nine and expects you to remember. Good for a chill and a bad stomach, useless for everything the man selling it to you is worried about.",
    price: 8,
    category: "remedy",
    tag: "priory",
  },
  {
    id: "rule-bread",
    name: "Barley Bread of the Rule",
    description:
      "Dense, dark and slightly sour, baked to the same weight every day for four hundred years. They give it away at the gate. He is selling it to people four days' walk from the gate.",
    price: 3,
    category: "provisions",
    tag: "priory",
  },
  {
    id: "bell-metal-button",
    name: "Bell-Metal Button",
    description:
      "Cast from the sweepings when the priory bell was recast, which happened once, in a year the weather book records and nobody else does. It rings, faintly, if you drop it on stone.",
    price: 5,
    category: "curio",
    tag: "priory",
  },
  {
    id: "prayer-said-once",
    name: "A Prayer, Said Once",
    description:
      "For somebody you name, at the priory, out loud, on his next round. He will not pretend to believe it and he will not shorten it, and he has never yet forgotten a name he took money for.",
    price: 2,
    category: "service",
    tag: "priory",
  },
];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * What he is offering at a place with this tag: the standing stock, plus
 * whatever the local pack holds. Pass a destination's `waresTag` straight in;
 * `undefined` (a stop where he is not trading anything local) is fine and gets
 * you the standing stock alone.
 */
export function waresFor(
  tag: string | undefined,
  catalogue: Ware[] = DEFAULT_WARES
): Ware[] {
  return catalogue.filter((w) => w.tag === "*" || (!!tag && w.tag === tag));
}

export function wareById(
  id: string,
  catalogue: Ware[] = DEFAULT_WARES
): Ware | undefined {
  return catalogue.find((w) => w.id === id);
}

// ---------------------------------------------------------------------------
// What is actually in the pack
// ---------------------------------------------------------------------------

/**
 * How many places' goods he is still carrying.
 *
 * `waresFor` answers "what does this kind of place sell", which is the right
 * question for a shop screen and the wrong one for a man with a pack. He does
 * not restock from nothing at every stop: he buys salt at the strand and is
 * still selling it four stops later in the hills, which is the entire trade and
 * the reason he walks. Four is the number that makes that legible — far enough
 * that the coast follows him inland for a good hour of world time, short enough
 * that by the time he is on the moor the salt has plausibly gone.
 */
export const PACK_MEMORY = 4;

export type CarriedWare = Ware & {
  /** The `Destination.waresTag` it came off. `"*"` is the standing stock. */
  from: string;
  /**
   * How many stocked-up places ago he picked it up. 0 is here-and-now, and the
   * standing stock is always 0 because he never stops having it. Use it to sort
   * a shop, to fade the old stuff, or to charge more for it — this module has
   * no opinion, because it does not know your economy.
   */
  stopsAgo: number;
};

/**
 * The trail, updated for arriving somewhere.
 *
 * Repeats move to the front rather than stacking, which matters: the round
 * takes in three stops on the strand in a row, and if each of those pushed an
 * entry then walking Saltmere would flush the quarry, the orchards and the fen
 * out of his pack for no reason. He did not pick up three packs. He picked up
 * more of the same one.
 */
export function restockAt(
  tag: string | undefined,
  trail: readonly string[] = [],
  memory: number = PACK_MEMORY
): string[] {
  const clean = (tag || "").trim();
  const kept = trail.filter((t) => t && t !== "*" && t !== clean);
  if (clean && clean !== "*") kept.push(clean);
  return kept.slice(-Math.max(1, memory));
}

/**
 * Everything on him, given where he has been. Freshest local goods first,
 * standing stock at the top because it is what he leads with.
 *
 * `trail` is oldest-first, most recent last — the shape `restockAt` returns.
 * Pass the resolved catalogue, not the defaults, or a project's `items` rows
 * will not be in his pack.
 */
export function packAfter(
  trail: readonly string[],
  catalogue: Ware[] = DEFAULT_WARES,
  memory: number = PACK_MEMORY
): CarriedWare[] {
  // Walk backwards so index 0 of `recent` is the place he has just left.
  const recent: string[] = [];
  const budget = Math.max(1, memory);
  for (let i = trail.length - 1; i >= 0 && recent.length < budget; i--) {
    const tag = (trail[i] || "").trim();
    if (!tag || tag === "*" || recent.includes(tag)) continue;
    recent.push(tag);
  }

  const carried: CarriedWare[] = [];
  for (const ware of catalogue) {
    if (ware.tag === "*") carried.push({ ...ware, from: "*", stopsAgo: 0 });
  }
  for (let i = 0; i < recent.length; i++) {
    for (const ware of catalogue) {
      if (ware.tag === recent[i]) carried.push({ ...ware, from: recent[i], stopsAgo: i });
    }
  }
  return carried;
}

/** "12 copper". Kept here so a shop UI and the API agree on the wording. */
export function formatPrice(price: number): string {
  const rounded = Math.round(price * 100) / 100;
  return `${rounded} copper`;
}

// ---------------------------------------------------------------------------
// Project overrides
// ---------------------------------------------------------------------------

/** A row of the `items` table, exactly as `select *` hands it over. */
export type ProjectItem = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  /** `numeric` comes back from PostgREST as a string often enough to matter. */
  price?: number | string | null;
  category?: string | null;
  icon_url?: string | null;
};

function toPrice(value: ProjectItem["price"]): number {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Splits a project's `category` into a tag and a category.
 *
 * `"fen/curio"` and `"fen:curio"` both mean "a curio he only has in the fen".
 * A bare `"curio"` means the item travels with him everywhere.
 */
function splitCategory(raw: string | null | undefined): {
  tag?: string;
  category: string;
} {
  const value = (raw || "").trim();
  if (!value) return { category: "general" };
  const match = /^([A-Za-z0-9_*-]+)\s*[/:]\s*(.+)$/.exec(value);
  if (!match) return { category: value };
  return { tag: match[1].toLowerCase(), category: match[2].trim() };
}

/**
 * Lays a project's `items` rows over `DEFAULT_WARES`.
 *
 * Matching is on the row's *name*, slugged — so "Road Bread", "road bread" and
 * "road-bread" are one item, and because every default id is itself a slug of
 * its name, naming a row `road-bread` also finds it. A matched row inherits the
 * default's `tag` unless it declares its own; an unmatched row is appended,
 * tagged `"*"` unless it declares otherwise.
 *
 * Order is stable: defaults keep their positions, new project items follow.
 */
export function resolveWares(
  projectItems: ProjectItem[] | null | undefined,
  options: ResolveOptions = {}
): Ware[] {
  const rows = (projectItems || []).filter((row) => (row?.name || "").trim());

  const overrides = new Map<string, ProjectItem>();
  for (const row of rows) overrides.set(slug(row.name as string), row);

  const toWare = (row: ProjectItem, base?: Ware): Ware => {
    const { tag, category } = splitCategory(row.category);
    return {
      id: base?.id ?? slug(row.name as string),
      name: (row.name as string).trim(),
      description: (row.description || base?.description || "").trim(),
      price: row.price === null || row.price === undefined ? base?.price ?? 0 : toPrice(row.price),
      category: category === "general" ? base?.category ?? "general" : category,
      tag: tag ?? base?.tag ?? "*",
      iconUrl: row.icon_url || base?.iconUrl || undefined,
      origin: "project",
      rowId: row.id || undefined,
    };
  };

  if (options.mode === "replace") return rows.map((row) => toWare(row));

  const merged: Ware[] = DEFAULT_WARES.map((ware) => {
    const row = overrides.get(slug(ware.name)) ?? overrides.get(ware.id);
    if (!row) return { ...ware, origin: "default" as const };
    overrides.delete(slug(ware.name));
    overrides.delete(ware.id);
    return toWare(row, ware);
  });

  for (const row of rows) {
    const key = slug(row.name as string);
    if (!overrides.has(key)) continue;
    overrides.delete(key);
    merged.push(toWare(row));
  }

  return merged;
}
