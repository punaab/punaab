/**
 * What Punaab knows about this valley, and where you have to stand to hear it.
 *
 * Lore is not a codex you buy in one lump. Each entry is pinned to a place —
 * `locationId` is a `Destination` id — and the intended shape is that the
 * player unlocks it by being there when he is. He tells you about the fen on
 * the causeway, in the wind, while he is watching the markers; he does not tell
 * you about it in an inn forty miles off, because forty miles off it is only a
 * story and he has enough of those.
 *
 * There is one entry for every stop on his round, in the order he walks them,
 * so reading this file top to bottom is the same journey he makes — out of the
 * Green, west through the field country, down the mere to the strand, east
 * through the orchards and the wood, across the fen to the gap, north up the
 * badlands to the March, back along the pine country to the snows, and home
 * over the moor and the Tarnwild.
 *
 * -------------------------------------------------------------------------
 * FOR GAME DEVELOPERS: replacing this
 * -------------------------------------------------------------------------
 * Every entry here is a default, and defaults lose. Put rows in the `lore_docs`
 * table for your project and `resolveLore()` lays them over these; the API
 * serves the result from `GET /api/v1/lore`.
 *
 *   1. REPLACE ONE ENTRY — give the row the same `title` as a default (matched
 *      loosely: "The Nine at Hollowmoor" == "the-nine-at-hollowmoor"). Your body
 *      wins. The default's location is kept, so it still unlocks where it did.
 *
 *   2. ADD A NEW ENTRY — any title that matches nothing is appended. Tell it
 *      where it belongs with directive lines at the top of the body:
 *
 *          location: elderloom-hall
 *          region: elderloom
 *          tags: history | ghosts
 *
 *          The wood was cleared once, in the reign of ...
 *
 *      Directives are optional, and the block only opens if the very first
 *      line is one of the recognised keys (`location`, `region`, `tags`) or a
 *      `---` fence — so a body that opens "Note: the road floods in spring" is
 *      stored exactly as you wrote it. Without a `location` the entry is
 *      unlocked anywhere, which is the right default for a project that has
 *      thrown out this world's map and is using its own.
 *
 *   3. THROW THE LOT AWAY — `resolveLore(rows, { mode: "replace" })` serves only
 *      your rows and none of Punaab's valley.
 *
 * The `location` you name can be any string your game understands. It is only
 * matched against `Destination.id` if you are still using this world.
 */

import { parseDirectives, slug, splitList } from "./wares";
import type { Origin, ResolveOptions } from "./wares";

export type LoreEntry = {
  id: string;
  title: string;
  body: string;
  /** The `Destination.id` that unlocks it. Empty = knowable anywhere. */
  locationId: string;
  /** `Region.id`, for a journal that groups by part of the map. */
  regionId?: string;
  tags?: string[];
  origin?: Origin;
  /** `lore_docs.id` of the row this came from, when it came from a project. */
  rowId?: string;
};

/**
 * Seventy-six entries, one for every destination on his round.
 *
 * They are written to be read aloud in his voice — short sentences, a fact you
 * could put on a map, and then the part of it that costs something. Nothing in
 * here explains a puzzle or gates a door; lore that is load-bearing stops being
 * lore and becomes a key.
 */
export const DEFAULT_LORE: LoreEntry[] = [
  // --- Wanderer's Green ----------------------------------------------------
  {
    id: "the-long-circuit",
    title: "The Long Circuit",
    locationId: "wanderers-cross",
    regionId: "wanderers-green",
    tags: ["roads"],
    body: "The great road does not go anywhere. It leaves the Green, takes in the fields, the mere, the orchards, the wood, the fen and the high pass, and comes back to this signpost having delivered you precisely where you started. It was cut that way on purpose, by people who wanted every farm within a day of every other farm and did not much care about the world beyond. I have walked it eleven times. I have never once met anyone who could tell me which direction is forward.",
  },
  {
    id: "the-sister-stones",
    title: "The Sister Stones",
    locationId: "sister-stones",
    regionId: "wanderers-green",
    tags: ["ruins", "mystery"],
    body: "Nine stones on the shoulder above the Green: eight standing, one on its back, and the one on its back is the only one with anything cut into it — three shallow bowls in a line, which is either a carving or four centuries of rain finding a soft patch. They are called the Sister Stones and there are no sisters in any story anybody here tells. The name came first and the story never turned up. Children play in them, courting couples meet in them, and the parish holds nothing there at all, which after the Nine out on the moor I find restful.",
  },
  {
    id: "the-crowfoot-lease",
    title: "The Crowfoot Lease",
    locationId: "crowfoot",
    regionId: "bracken-hollow",
    tags: ["work", "history"],
    body: "Three generations of Crowfoots have farmed this ground on a lease of ninety-nine years, and there are nine years left on it. The land belongs to a family four days east who have not sent anybody to look at it since the old man's father was a boy. They will renew. Everybody says they will renew. The new barn went up two summers ago — good timber, forty pounds of somebody's savings — and you do not build a barn like that if you think you are leaving. You build it to make leaving unthinkable to a stranger with a ledger.",
  },
  {
    id: "the-market-peace",
    title: "The Market Peace",
    locationId: "wealdmoot-market",
    regionId: "wanderers-green",
    tags: ["custom", "law"],
    body: "From the bell at dawn to the bell at dusk, on market days, the peace holds inside the square: no debt called in, no summons served, no blow struck. It is older than the magistrate and it is enforced by everyone at once, which is the only enforcement that has ever worked anywhere. The practical effect is that people who cannot be in a room together can be in a market together, twice a month, and buy each other's eggs without speaking. Half the marriages in this valley began with somebody's arm not being taken hold of.",
  },
  {
    id: "the-moot-bench",
    title: "The Moot Bench",
    locationId: "moot-bench",
    regionId: "wanderers-green",
    tags: ["law", "custom"],
    body: "One stone bench outside the hall, where the magistrate hears everything that does not need a roof: boundaries, beasts, bad debts, and the occasional accusation nobody wants written down. Hearing it outdoors is deliberate and very old. There is no room to be taken into, so there is no conversation that happened before the hearing. Anyone may stand and listen, and they do, and the standing crowd is most of what keeps it honest. I have eaten for a full day off a bench, a queue, and no lute at all.",
  },
  {
    id: "the-millers-tenth",
    title: "The Miller's Tenth",
    locationId: "longmead-mill",
    regionId: "wanderers-green",
    tags: ["work", "custom"],
    body: "The mill takes a tenth of what it grinds. It is written down, it has been a tenth since the mill was raised, and every household in the parish will tell you privately that the man takes a ninth. That accusation is older than this miller, older than his father, and was made against the mill that stood here before this one. It is not really about flour. A mill is the one thing a village cannot do without and cannot do for itself, and being unable to do something for yourself is a debt you end up paying in suspicion.",
  },
  {
    id: "the-three-parish-stone",
    title: "The Three-Parish Stone",
    locationId: "three-parish-stone",
    regionId: "wanderers-green",
    tags: ["roads", "custom"],
    body: "A waist-high stone in a hedge where Wealdmoot, Barleyhearth and the Green all stop. Three grooves in the top, one down each boundary, and a flat face broad enough to sit somebody on. At Rogation the three parishes walk their bounds and meet here, and at the meeting they take the youngest boy from each and bump his head, gently, against the stone, so the line lives on inside a person for another sixty years. It is barbaric and it is efficient, and there has never been a boundary dispute at this corner, which is more than can be said for anywhere else in the valley.",
  },

  // --- Barleyhearth and the field country ----------------------------------
  {
    id: "the-well-at-hearthwick",
    title: "The Well at Hearthwick",
    locationId: "hearthwick",
    regionId: "barleyhearth",
    tags: ["water", "custom"],
    body: "Hearthwick is one farm on the north road with the deepest well in the parish, and in the four dry years it was the only well on this road that held. The family drew for everybody, all summer, for nothing, and would not be paid, and were not thanked in words because the thing was too large for words and everyone understood that. There is still a lid on the well, a cup beside it, and no gate on the lane. I asked once why they never charged. They looked at me the way you would look at a man asking why the sky.",
  },
  {
    id: "what-the-hedge-remembers",
    title: "What the Hedge Remembers",
    locationId: "liars-acre-hedge",
    regionId: "barleyhearth",
    tags: ["history", "custom"],
    body: "A laid hedge remembers. The stools are cut and bent along a line and they hold that line for a century, whatever anybody later decides the boundary is. Sight along the hedge on Liar's Acre from the low end and it bends, once, about forty paces in, and then recovers — which is what a hedge does when it has been re-laid around a stone that was not where the last man left it. That is not proof of anything. It is the only evidence either family has ever had, and they have both been looking at it, from their own ends, for sixty years.",
  },
  {
    id: "the-naming-of-fields",
    title: "The Naming of Fields",
    locationId: "barleyhearth",
    regionId: "barleyhearth",
    tags: ["custom", "history"],
    body: "Every field here has a name and the name is a court record. Widow's Half was split in a will that took nine years to argue. Liar's Acre is where a boundary stone was moved one night in a year nobody will specify. Goodwill is the smallest and worst field in the parish, given to a neighbour as a gesture and received as an insult, and both households have been correct about that ever since. Learn the names before you drink here. You will be walking through somebody's grievance either way, but at least you will know whose.",
  },
  {
    id: "the-drovers-crossing",
    title: "The Drovers' Crossing",
    locationId: "sildwater-ford",
    regionId: "barleyhearth",
    tags: ["roads", "water"],
    body: "Before the causeway there was a ford, and before the ford there was a man with a pole who told you whether today was a day for crossing. He was wrong twice in forty years, which is a very good record and no comfort at all to the four families involved. The bridge they built afterwards is three feet higher than the water has ever come. That is not engineering. That is an apology in stone.",
  },
  {
    id: "the-oxleaze-team",
    title: "The Oxleaze Team",
    locationId: "oxleaze",
    regionId: "barleyhearth",
    tags: ["work", "history"],
    body: "Oxleaze kept eight oxen when everyone else had gone to horses, on the argument that an ox eats grass and a horse eats corn and corn is money. The argument was right, and then it stopped being right inside a decade, and the team was sold in one morning to a dealer from the east. There is a bare ring by the gate where they stood to be yoked and the grass has not taken it back in twenty years. The old man can still name all eight. He will, if you let the silence run long enough, and then he changes the subject himself.",
  },
  {
    id: "the-burning-of-ashcroft",
    title: "The Burning of Ashcroft",
    locationId: "ashcroft",
    regionId: "barleyhearth",
    tags: ["ruins", "mystery"],
    body: "Ashcroft burned thirty years ago in the night and nobody died, which is the first thing anyone tells you, and the way they tell it is odd. What happened afterwards is odder. The family left the valley, the land was never ploughed again, and the well was filled in with stone — deliberately, by somebody, and no one will say who or why. A well is a year of a man's work. You do not fill one in for tidiness. Four walls, no roof, and an apple tree in the yard still cropping every autumn for nobody. I have asked in six villages and been kindly not answered in all six.",
  },
  {
    id: "the-drowned-lane",
    title: "The Drowned Lane",
    locationId: "mirrormere-shore",
    regionId: "barleyhearth",
    tags: ["water", "history"],
    body: "In a dry autumn the mere pulls back off the north shallows and you can see a lane down there — proper hedged lane, two ruts, running out into the water and not coming up on the far side. The mere is younger than the road. Something moved, or something was dammed, and a valley's worth of walking became a fishery in a single wet decade. They still call the water over it Long Lane, and the fishers will not set a net across the line of it, and if you ask why they will look at you as if you had asked why one does not shout in a church.",
  },
  {
    id: "the-last-milestone",
    title: "The Last Milestone",
    locationId: "westward-mile",
    regionId: "tarnwild",
    tags: ["roads"],
    body: "The stone says eleven miles, and it does not say to where. The road it counted stops in bracken two hundred paces on, and there is no sign it ever meant to stop. Either it was abandoned mid-work, or the eleven miles were somewhere that is no longer eleven miles away. I put my hand on it every time I come out here, which is a foolish habit for a grown man, and I do it because somebody carried this thing to the edge of the map and set it down facing outward.",
  },

  // --- The mere, the strand and the quay -----------------------------------
  {
    id: "underlyme",
    title: "Underlyme",
    locationId: "underlyme",
    regionId: "saltmere",
    tags: ["water", "history"],
    body: "Underlyme is under the mere on the west side, and in a dry autumn you can see it: gable ends, a run of walling, the stump of a tower. It did not drown in a night. The water came up over about forty years and the village went with it house by house, and they carried the doors and the window frames and the roof timbers out as they went — which is why there is not a scrap of worked wood down there, and why the story that it drowned in one night with everybody in it is nonsense, and why that is the only version anybody sings. Slow is very hard to make a song out of.",
  },
  {
    id: "what-the-strand-keeps",
    title: "What the Strand Keeps",
    locationId: "low-strand",
    regionId: "saltmere",
    tags: ["water", "custom"],
    body: "Everything the mere takes comes ashore on this low corner eventually — oars, hats, the odd boat, once a whole door. There is a rule about it that nobody wrote down: you may keep what you find, but you must leave it out on the shingle one full night first, in case it is being looked for. Half the houses along here are furnished out of that one night's grace. I have never seen anyone break the rule and I have never met anyone who came back for anything.",
  },
  {
    id: "the-ninefoot",
    title: "The Ninefoot",
    locationId: "ninefoot-wreck",
    regionId: "saltmere",
    tags: ["water", "custom"],
    body: "Nine feet of clinker-built boat up on the shingle south of the quay, ribs open to the sky, older than any man who could tell you her name. Every spring somebody tars the stem. Not the strakes, not the keel — the stem, which is the one piece that was never going to rot anyway. That is the whole of the custom, and nobody at the quay will admit to being the one who does it. There is a name on the transom you can read in a low sun from exactly one angle, and I know it, and I have decided not to write it anywhere.",
  },
  {
    id: "the-salt-on-the-west-wind",
    title: "The Salt on the West Wind",
    locationId: "saltmere-strand",
    regionId: "saltmere",
    tags: ["water", "mystery"],
    body: "It is fresh water. Everything that lives in it is a freshwater thing. And still, after a hard blow out of the west, there is salt crusted on the rocks at the strand, and you can scrape it and cook with it and it is perfectly good salt. Four hundred years of people have proposed an underground sea, an old wound in the rock, and a curse, in roughly that order of respectability. The strand has stopped caring which. They sell it by the pint and they let you have your theory for free.",
  },
  {
    id: "the-lamp-that-is-still-lit",
    title: "The Lamp That Is Still Lit",
    locationId: "mere-lamp",
    regionId: "saltmere",
    tags: ["custom", "water"],
    body: "A lamp on a post at the head of the quay, lit every night of the year. The last boat that needed it came in nineteen years ago. The oil is a parish charge and it appears in the accounts as 'the lamp', unitemised, and no one has ever queried it — not the magistrate, not the two men who audit the parish and who audit everything, not the family who might have been expected to say something and did not. Everyone in Saltmere knows who the lamp is for. Nobody says. The nets on the fences are perfectly kept as well, and there are no boats.",
  },

  // --- Cidergarth ----------------------------------------------------------
  {
    id: "telling-the-bees",
    title: "Telling the Bees",
    locationId: "bee-garth",
    regionId: "cidergarth",
    tags: ["custom"],
    body: "When somebody in the garth dies, one of the household walks the rows before the burial, knocks on each skep, and tells the bees, out loud, by name. If it is not done, the bees are said to leave. What is certainly true is that these bees pollinate every orchard for two miles, and a bad year for bees is a bad year for cider, and a bad year for cider is a bad year for everybody — so the custom sits exactly where superstition and bookkeeping stop being distinguishable. A black ribbon goes on the end hive and stays a month. I have never once heard anybody here laugh about it.",
  },
  {
    id: "the-mother-of-apples",
    title: "The Mother of Apples",
    locationId: "mother-of-apples",
    regionId: "cidergarth",
    tags: ["custom", "trees"],
    body: "The tree behind the shrine is not the oldest tree here, it is the *first* — every orchard in the garth is cut from it, and cut from cuttings of it, so in the way that matters there is one apple tree in this region and it is nine hundred acres wide. It is propped now. Three posts and a leather strap and a woman paid out of parish funds to keep the rot out of it. She has the only job in the valley with no retirement, because you do not hand that over lightly, and she is training her sister's girl already.",
  },
  {
    id: "the-long-row",
    title: "The Long Row",
    locationId: "long-row",
    regionId: "cidergarth",
    tags: ["custom", "trees"],
    body: "The oldest planting in the garth, and every tree in it stands for a person: you put one in when somebody goes, and you name it, and that family prunes it. So the row is a burial ground that yields about forty pounds of fruit a tree, and the fruit gets pressed and drunk at the wake of the next one. Third from the end is a child's, and it is by a distance the best-kept tree in the garth, and nobody has ever had to be asked to keep it that way.",
  },
  {
    id: "the-blackjack-year",
    title: "The Blackjack Year",
    locationId: "cidergarth",
    regionId: "cidergarth",
    tags: ["history"],
    body: "One spring the frost came late and took the blossom off everything, and the garth had no apples and no cider and no money coming. So they opened the deep casks — the black cider, the stuff kept back for weddings and wakes and nothing else — and they drank the reserve of forty years in a single summer, on the grounds that they were going to lose it all anyway. The trees came back the next year. The casks did not. Every old family here still owes every other old family a barrel, and every one of them will tell you so before you finish your first cup.",
  },
  {
    id: "the-windfall-right",
    title: "The Windfall Right",
    locationId: "appleyard",
    regionId: "cidergarth",
    tags: ["custom", "law"],
    body: "Fruit on the tree belongs to whoever owns the tree. Fruit on the ground belongs to whoever picks it up. That is the whole of orchard law here and it has never needed a second clause. It is why there are people in the orchards before light after a gale, and why nobody calls that theft. It also explains the one thing outsiders always get wrong: shaking a tree is stealing. Everybody here can tell a shaken tree from a blown one at a glance, and nobody has ever had to prove the difference in front of the magistrate, because nobody has ever tried it twice.",
  },

  // --- Elderloom -----------------------------------------------------------
  {
    id: "the-ring-in-gangers-meadow",
    title: "The Ring in Ganger's Meadow",
    locationId: "fairy-ring",
    regionId: "elderloom",
    tags: ["mystery", "trees"],
    body: "A ring of mushrooms in the meadow below Elderloom, forty paces across, and moving — north, about a hand's width a year, which over a life is enough to notice and not enough to argue about. It is one organism, growing outward from a stump that rotted before this parish had a name, and the ring is simply the edge of it. I have explained that to people. They nod, and agree entirely, and then walk around it. So do I. Knowing what a thing is turns out to be a completely separate question from wanting to stand in the middle of it.",
  },
  {
    id: "the-deer-leap",
    title: "The Deer Leap",
    locationId: "deer-leap",
    regionId: "elderloom",
    tags: ["ruins", "history"],
    body: "A bank with the ditch on the inside, running eleven miles round what was once somebody's deer park. The shape is cruel and elegant: a deer can jump down into the park and cannot jump back out of it, so the park fills and never empties. There is no house left, no family left, and no record of who was granted the right. There are still deer, and there has been no park for five hundred years, so the deer are simply deer now and the bank is simply a bank. Everything anybody builds ends up being about something else.",
  },
  {
    id: "the-wood-that-answers",
    title: "The Wood That Answers",
    locationId: "elderloom-hall",
    regionId: "elderloom",
    tags: ["mystery", "trees"],
    body: "Shout in Elderloom and the wood gives it back to you a beat late and a note low, which is what a close canopy does to a sound and is not, on its own, remarkable. What unsettles people is that it gives back things they are certain they did not say. The wood has a fair collection by now: a name, a laugh, somebody counting. My own theory is that a hundred generations of travellers have shouted into these trees and the trees have simply got very good at it. I would rather that were true, so I have stopped testing it.",
  },
  {
    id: "the-willow-count",
    title: "The Willow Count",
    locationId: "willowpond",
    regionId: "elderloom",
    tags: ["custom", "water"],
    body: "Eleven willows round the pond, and the parish counts them every Candlemas, out loud, with a boy sent round the far side to check. It has been eleven for as long as the book goes back — willows fall and willows root and somehow the number holds. The count is not superstition, exactly. It is an excuse to walk down here in the cold together once a year and see that the water is where it was. Most rituals are that, underneath. A way of standing in a place with other people and agreeing it is still there.",
  },
  {
    id: "the-charcoal-burners",
    title: "The Charcoal Burners",
    locationId: "colliers-hearth",
    regionId: "elderloom",
    tags: ["work"],
    body: "A hearth is a flat black circle twelve paces across where a charcoal stack has stood, and nothing grows on it for a lifetime after. Building the stack takes two days; burning it takes a week, and the week is spent awake, because if it takes flame you lose everything in it. They live in a turf hut alongside and sleep in shifts of two hours. Charcoal makes iron and iron makes everything, and there are three men left in this valley who can raise a stack. I sat up one night with them. I did not offer twice.",
  },

  // --- Thornwake Fen -------------------------------------------------------
  {
    id: "the-reed-year",
    title: "The Reed Year",
    locationId: "sedge-cut",
    regionId: "thornwake",
    tags: ["work", "water"],
    body: "Reed is cut in winter, standing in water, ideally on ice, and everything a cutter owns is wet from December to March. It is worked in strips on a four-year turn — cut one, leave three — and a strip that gets missed is closed by the fen and gone for good. A well-laid reed roof outlasts the thatcher who laid it by thirty years, which is a fact thatchers do not enjoy and reed cutters mention constantly. Fenreed roofs half this valley off eleven acres of standing water that nobody owns and everybody's grandfather agreed about.",
  },
  {
    id: "the-firm-ground",
    title: "The Firm Ground",
    locationId: "fenreed",
    regionId: "thornwake",
    tags: ["geography", "custom"],
    body: "Fenreed stands on the only firm ground for a mile, and 'firm' is a claim that has to be renewed. Every spring two of them walk the boundary with a sounding pole, at the same season each year, and mark where the pole goes in easy. The hamlet has been moved twice inside living memory — same name, same families, same three arguments — and both times it moved before it had to, on the evidence of a stick pushed into mud. The punts are moored at the back doors, not the front. That is not picturesque. That is a hamlet that knows which way it will be leaving.",
  },
  {
    id: "the-causeway-markers",
    title: "The Causeway Markers",
    locationId: "fenmere-edge",
    regionId: "thornwake",
    tags: ["custom", "danger"],
    body: "Forty-one posts, each with an iron cup on top, and the last house on either end has the standing duty of lighting them from dusk in the wet season. There is no fee for it and no getting out of it. The house that fails to light them is not fined; it is simply never spoken of again by anyone on that road, which as punishments go is efficient and has needed using twice. Count the posts as you pass. If you get thirty-nine, you have missed two, and the ones you missed are the two that matter.",
  },

  // --- The Sunder Flats and the eastern gap --------------------------------
  {
    id: "hallowfield",
    title: "Hallowfield",
    locationId: "hallowfield",
    regionId: "sunder-flats",
    tags: ["history", "ruins"],
    body: "Flat ground east of the fen with a ditch across it that is not a field ditch — too deep, too straight, and going nowhere useful. The name is old and means the field of the dead in a language nobody here has spoken for centuries. The plough brings up buckles, mostly, and once in my lifetime a helmet, which went for scrap because it was good iron and the man wanted a hinge. Nobody can tell me who fought here, or when, or which side this valley was on. Both, probably. That is how it usually goes on a road that is the only road in.",
  },
  {
    id: "the-gap-that-was-left",
    title: "The Gap That Was Left",
    locationId: "east-gap",
    regionId: "sunder-flats",
    tags: ["geography", "roads"],
    body: "Stand in the gap and you can see the valley behind you and a great deal of nothing ahead. Every trader, army, plague and idea that ever reached us came through this notch, because there is no other door. There was a gate here once — you can find the post sockets cut in the rock, a cart's width apart. Nobody has thought it worth rebuilding in living memory. That tells you either that we have been very lucky, or that we have simply not been worth the walk.",
  },
  {
    id: "farrows-try",
    title: "Farrow's Try",
    locationId: "farrows-try",
    regionId: "sunder-flats",
    tags: ["history", "work"],
    body: "Farrow took a lease on the flats and ploughed them, once. You can still find the furrows if you get down low: dead straight for three hundred paces and then stopped mid-row, which is a man making up his mind in the middle of a morning. There is a hearth stone, four post holes, and eleven years of unpaid rent still standing in the Wealdmoot book. Everybody laughs at Farrow. I have noticed that everybody who laughs at Farrow is standing on ground somebody else broke first, and that we do not know that man's name either.",
  },
  {
    id: "how-the-fen-drains",
    title: "How the Fen Drains",
    locationId: "sunder-flats",
    regionId: "sunder-flats",
    tags: ["water", "geography"],
    body: "All the wet in the east has one way out and this is it: a shallow spill across the flats, going east through the only gap the mountains left open. In a hard winter you can hear it from a mile off, a flat wide hiss with no waterfall in it anywhere. The flats are not empty because nothing will grow. They are empty because everything that grew got taken east, an inch of soil at a time, for as long as there has been a fen to drain.",
  },
  {
    id: "the-sunder-watch",
    title: "The Sunder Watch",
    locationId: "sunder-watch",
    regionId: "sunder-flats",
    tags: ["ruins"],
    body: "Two walls and a doorway on the rise above the flats, looking east down the road from the gap. Whoever built it wanted a night's warning and had reason to. Whoever kept it did so long enough to wear the threshold down. There is a hearth in the corner that has been used within the month; nobody claims the place, nobody repairs it, and the fire ring is always clean. The men who watched from here were watching for something coming in. Whoever sits here now builds their fire on the eastern side of the wall, which means they are watching the valley.",
  },
  {
    id: "the-fen-bell",
    title: "The Fen Bell",
    locationId: "fen-bell",
    regionId: "thornwake",
    tags: ["custom", "danger"],
    body: "A bell on a post at the fen's edge, rung when the fog comes down and kept ringing until whoever is out there is in. The rope lives in the house so children cannot play with it — which means that when the fog comes, the first thing anybody does is cross forty paces of open ground to fetch a rope, and forty paces in a fog like that is a real decision. Once a year they ring it for every man the fen has taken, one at a time, with the name said first. It takes most of an afternoon. I have stood through it twice and I count it among the harder things I do.",
  },
  {
    id: "why-nobody-crosses-thornwake",
    title: "Why Nobody Crosses Thornwake",
    locationId: "fen-causeway",
    regionId: "thornwake",
    tags: ["danger", "history"],
    body: "It is not the water. It is that the fen has no landmarks and it changes the ones it has. A sedge island in spring is open water by autumn; the pools move; the one hill you were steering by turns out to be a different hill of the same height, and by the time you know that, you have been walking an hour in the wrong direction on ground that will not hold a horse. The causeway was built to give the fen one true line through it, and the rule that goes with it is the shortest law in the valley: keep to the stones. People do not avoid Thornwake because it is haunted. They avoid it because it is fair, and it is fair in the way a cliff is fair.",
  },

  // --- Bracken Hollow ------------------------------------------------------
  {
    id: "the-hollow-orchard",
    title: "The Hollow Orchard",
    locationId: "hollow-orchard",
    regionId: "bracken-hollow",
    tags: ["trees", "work"],
    body: "Sixty trees in Bracken Hollow, none of them under seventy, and nobody under fifty in the parish to prune them. An old apple hollows out from the middle and goes on cropping for decades as a shell — a chimney with bark on it — and then one gale takes the lot inside a week, because they are all the same age and all equally tired. Cidergarth will give a cutting off the mother tree to anybody who will carry it here and get it into the ground. That offer has stood for four years. It is the cheapest useful thing in this valley and it is still standing unclaimed.",
  },
  {
    id: "the-keep-ditch",
    title: "The Keep Ditch",
    locationId: "keep-ditch",
    regionId: "bracken-hollow",
    tags: ["ruins", "history"],
    body: "There is no keep at Bracken Keep. There is a ditch, a bank, and the outline of a hall, and every dressed stone that stood above ground went into barns and doorsteps inside a generation of the last man walking out. You can pace the whole plan in two minutes: hall, gate, kitchen, yard. What is strange is not the robbing — that is universal — but that nobody local will say who held it or against whom, in a valley where people can name every field for four hundred years. That is not a gap in the record. Somewhere along the way it became a thing one does not say.",
  },
  {
    id: "the-warm-hollow",
    title: "The Warm Hollow",
    locationId: "bracken-hollow",
    regionId: "bracken-hollow",
    tags: ["geography", "trees"],
    body: "Bracken Hollow is a fortnight ahead of the rest of the valley and a fortnight behind it letting go — the first green and the last leaf, every year, without fail. It is only a dip in the land with a hill on the cold side, which is a dull explanation for a place people used to bring sick children. The bracken gets waist-high by midsummer and hides everything: paths, walls, sheep, the occasional traveller who sat down for a moment. Shout before you cut through. It is polite, and it is also practical.",
  },
  {
    id: "the-fever-slope",
    title: "The Fever Slope",
    locationId: "wintergreen-bank",
    regionId: "bracken-hollow",
    tags: ["custom", "geography"],
    body: "A south-facing bank with the hill at its back, out of the wind entirely, green in February. People carried sick children up here and sat with them in the sun, sometimes for weeks, and some of them got better. The explanation is warmth, rest and clean air, and the explanation is not the point — when your child is ill you want somewhere to take them, and having somewhere to take them is itself a kind of medicine. There is a flat stone at the top worn hollow by sitting. It is the only monument on this bank and it is the right one.",
  },

  // --- Ashenreach ----------------------------------------------------------
  {
    id: "why-the-stone-runs-red",
    title: "Why the Stone Runs Red",
    locationId: "red-quarry",
    regionId: "ashenreach",
    tags: ["geography", "work"],
    body: "Iron in the rock, rusting for an age and a half. That is all it is, and every mason in the valley will tell you so, patiently, again. The other explanation is older and shorter and involves a battle, and it survives not because anyone believes it but because it is the version that fits a tune. I have made a living off that difference for twenty years. The quarry cut the stone for the Hold, for the bridge, and for about nine hundred doorsteps, and then in one wet spring the lower workings filled and stayed filled. The water in them is still the colour of a rusted nail.",
  },
  {
    id: "the-blackrun-bridge",
    title: "The Blackrun Bridge",
    locationId: "blackrun-crossing",
    regionId: "ashenreach",
    tags: ["roads", "water"],
    body: "The Blackrun comes off the badlands carrying red grit, and it has cut itself a gorge you would not want to look into twice. The bridge is a single span with no parapet, because a parapet catches wind and this crossing gets wind the way a bell gets a hammer. There is a mark on the abutment showing where the flood reached the year the quarry lost its lower workings. It is above your head. Cross when it is quiet, and do not stop in the middle to look, whatever your legs tell you.",
  },
  {
    id: "the-ashen-hold",
    title: "The Ashen Hold",
    locationId: "ashen-hold",
    regionId: "ashenreach",
    tags: ["ruins", "history"],
    body: "A watchtower and a walled yard on the red terraces, built to see the eastern gap and hold the road under it. The stonework is good — better than anything standing in the valley now — and it was fired from the inside. You can read that off the walls: the scorch runs up and out of the window slots, and the door was barred from within when the roof came down on it. So they were not taken. They shut themselves in and something burned. Nobody knows the garrison's name, or who set them there, or whether relief ever came up the road for them. There is a stair down under the yard. I have stood at the top of it with a lantern more than once, and I have always found a reason to be somewhere else by nightfall.",
  },
  {
    id: "what-the-delve-owes",
    title: "What the Delve Owes",
    locationId: "the-delve",
    regionId: "ashenreach",
    tags: ["work", "history"],
    body: "The Delve cuts red stone and has been losing to water since the old king died. Below the third gallery there is ore — good ore, by the look and the weight of it — and it will not weld: it comes out of the fire short and cracks under the hammer, and the best smith in the valley broke four hammers proving that to his own satisfaction. So they cut building stone instead, which pays a third as well, and every man at the Delve is owed wages by somebody who is himself owed wages. It has gone on so long that they have stopped calling it a debt. They call it the delve.",
  },
  {
    id: "the-ashgate-watch",
    title: "The Ashgate Watch",
    locationId: "ashgate-watch",
    regionId: "ashenreach",
    tags: ["ruins", "custom"],
    body: "A tower on the ridge above the ash track with a fire ring and a stack of kept-dry wood, and nobody posted. The wood is dry. Somebody climbs up here and keeps it dry, and has been doing it long enough that the stack has a shape to it. Inside, on the stair, there is a name scratched into every course — the same name, the same hand, climbing, the letters getting worse as the courses go up. Whether that is one man over forty years or a family copying a father, I have never worked out, and I have gone up that stair with a candle more times than the view justifies.",
  },

  // --- The Kestrel March ---------------------------------------------------
  {
    id: "the-long-screes",
    title: "The Long Screes",
    locationId: "long-screes",
    regionId: "kestrel-march",
    tags: ["danger", "geography"],
    body: "Half a mile of loose rock lying at exactly the angle loose rock lies at — which is the angle at which it is about to stop lying there. Cross high, where it has set, or cross low, where the run-out is short. Crossing the middle is how everybody learns which. Nothing grows on it: not lichen, not thrift, nothing, because nothing gets three years in one place. The one useful thing I have learned on the screes is that going down is quieter than going up, and that the quiet is not a good sign.",
  },
  {
    id: "the-hawkstone-cairn",
    title: "The Hawkstone Cairn",
    locationId: "hawkstone-cairn",
    regionId: "kestrel-march",
    tags: ["custom", "ruins"],
    body: "Chest-high, at the highest walkable point in the valley, and it grows: everyone who gets up here adds a stone. There is no story attached, no saint, no battle, nobody buried under it — I have asked in nine villages. It is a heap of proof that people have been this far. That is the entire custom and I think it is the best one we have. Add yours from below the ridge, not from the cairn's own scree. Carrying it is the point.",
  },
  {
    id: "the-weather-cross",
    title: "The Weather Cross",
    locationId: "weather-cross",
    regionId: "kestrel-march",
    tags: ["custom", "geography"],
    body: "A stone cross on the watershed at the top of the March, arms worn down to stumps. Rain landing on the west face goes to the mere and eventually past every village in this valley; rain landing on the east face goes out through the gap and nobody here knows where. Somebody carried a cross to the highest walkable ground in the country to mark a line that cannot be seen and cannot be crossed wrongly. That is either the most useless labour ever performed in this valley or the only honest monument in it, and I change my mind about which roughly every time I come up.",
  },
  {
    id: "the-anchorites-cell",
    title: "The Anchorite's Cell",
    locationId: "anchorites-cell",
    regionId: "kestrel-march",
    tags: ["ruins", "mystery"],
    body: "A cave under the crag with a drystone wall built across the mouth of it and a slot in the wall the width of a bowl. That is an anchorite's cell: somebody was walled in, on purpose, with their own consent, and fed through the slot until they died. Forty years, the story says. The bottom edge of the slot is worn smooth and rounded, which is the only part of the story I can verify, and it is the part that stops the conversation. There is a cup on the ledge inside and it is not an old cup. I do not go in. I sit outside where the light is and say hello.",
  },
  {
    id: "the-march-nobody-held",
    title: "The March Nobody Held",
    locationId: "kestrel-march",
    regionId: "kestrel-march",
    tags: ["history", "geography"],
    body: "A march is a border you keep soldiers on. There have never been soldiers up here. The name came down from somebody's map, drawn by somebody who had not been, and it stuck the way wrong names do — because it sounded like a place that ought to exist. What is up here is bare crag, thin air, and the birds, and the birds have never had a reason to be afraid of a person, which is the loneliest fact I know about this valley. They will let you walk right up. Nothing has taught them not to.",
  },

  // --- Greyneedle ----------------------------------------------------------
  {
    id: "the-crows-of-crowtarn",
    title: "The Crows of Crowtarn",
    locationId: "crowtarn",
    regionId: "greyneedle",
    tags: ["mystery", "water"],
    body: "They come in at dusk from the whole of the pine country, a few thousand of them, and they go round the tarn three times before they settle. Not twice. Not once. The foresters set their evening by it. There is no reason for it that anyone can give me, and I have watched it perhaps forty times, and every time I catch myself counting along under my breath like a man checking a debt. Then they drop into the trees all at once and the wood goes quieter than it was before they came.",
  },
  {
    id: "the-night-the-wood-went-over",
    title: "The Night the Wood Went Over",
    locationId: "deadfall",
    regionId: "greyneedle",
    tags: ["history", "trees"],
    body: "Nine hundred trees went down in Greyneedle in one night, all lying the same way, in a swathe you can pick out from the March. It was wind. We know the hour of it because the priory was awake and the bell was rung and a brother wrote the hour in the weather book, which is the only thing in this valley that has kept four hundred years of nights. You do not walk the deadfall, you climb it, and it takes two hours to cross what used to take twenty minutes. The young growth coming up through it is the best in the wood. It will be a better wood than the one that fell. Not in my time, and not in yours.",
  },
  {
    id: "the-needle-path",
    title: "The Needle Path",
    locationId: "greyneedle-wood",
    regionId: "greyneedle",
    tags: ["roads", "trees"],
    body: "There is a good hand's depth of dead needles over everything in Greyneedle, and it takes the path with it — you cannot see the road, only a long low channel where nothing has grown for two hundred years. Walk it and you make no sound at all. That is pleasant for the first mile. In the second mile most people start humming, and by the third they are singing whether or not they can, and I have met three separate men who swore they were being followed and were in fact simply not able to hear themselves being alone.",
  },
  {
    id: "the-rule-and-the-bell",
    title: "The Rule and the Bell",
    locationId: "priory",
    regionId: "greyneedle",
    tags: ["custom", "history"],
    body: "Nine brothers, one bell, and a rule of silence observed about as well as nine men in a wood were ever going to observe it. They will feed anybody who knocks, they will not ask your name, and they will not give you theirs, and after eleven years of coming here I know one. I am permitted to play and not to sing, which has never been explained to me, and which I have never asked about, and the not-asking is the entire reason I am still permitted. They keep a book of the weather going back four hundred years. It is the most useful document in this valley and nobody outside these walls has read it.",
  },

  // --- Skarnfell -----------------------------------------------------------
  {
    id: "last-roof-before-the-pass",
    title: "Last Roof Before the Pass",
    locationId: "skarnfoot",
    regionId: "skarnfell",
    tags: ["roads", "work"],
    body: "Skarnfoot exists because of eleven weeks. For eleven weeks a year the pass is shut, the road ends here, and everybody who arrives has to stop — so the village keeps beds, feed, a forge and a great deal of opinion, and prices all of it for a man who must decide within the hour whether he is going over. It is not gouging. It stands close enough to gouging that they have developed several very good ways of describing it. And not one person born in Skarnfoot has ever crossed the pass. Ask them. They find the question funny, and then they find it less funny.",
  },
  {
    id: "the-woman-who-shuts-the-pass",
    title: "The Woman Who Shuts the Pass",
    locationId: "snow-gate-cottage",
    regionId: "skarnfell",
    tags: ["custom", "danger"],
    body: "The last cottage below the pass has held the decision for four generations: the woman there walks up, looks, and comes down, and the day she does not walk up again is the day the pass is shut. There is no bell, no notice and no appeal, and the whole valley reads the answer off whether her door stands open. She has been wrong once in thirty-one years — shut it four days early, on a week that turned fine — and nobody was hurt, and she has not forgiven herself, and I have watched her not forgive herself across two decades. Her mother did it. Her daughter has said she will not.",
  },
  {
    id: "the-snow-gate",
    title: "The Snow Gate",
    locationId: "skarn-pass",
    regionId: "skarnfell",
    tags: ["roads", "danger", "custom"],
    body: "The pass shuts for about eleven weeks a year, and the day it shuts is decided by a woman in the last cottage below it who walks up, looks, and comes back down. There is no signal, no bell, no proclamation. She simply does not come back up again, and everyone knows what that means. When it opens, the first person through carries the post for nothing. That has been the arrangement so long that the first person through in living memory has always been a volunteer, and there has always been more than one.",
  },
  {
    id: "where-the-sildwater-begins",
    title: "Where the Sildwater Begins",
    locationId: "high-snows",
    regionId: "skarnfell",
    tags: ["water", "geography"],
    body: "It comes out of a crack in a rock about the size of your hand, and you can stop it with your thumb, and I have, and I felt like a thief. Sixty miles downstream it is turning three mills and drowning the occasional drover. Every river in the valley starts like this, out of snow up here that never entirely goes, in a hollow the sun reaches for about an hour in high summer. There is no shrine at the spring. There is a tin cup on a chain that somebody replaces when it wears through.",
  },
  {
    id: "the-whinstone-fold",
    title: "The Whinstone Fold",
    locationId: "whinstone-fold",
    regionId: "skarnfell",
    tags: ["work", "custom"],
    body: "A ring of drystone on the fell with one gap in it, and the gap faces away from the prevailing wind, which is four hundred years of somebody paying attention rather than four hundred years of luck. The flock is gathered in here before the snow gate shuts and brought down in a single day. If you are late you winter on the fell with them, and men have, and two of them are still named. There is no mortar anywhere in it. It has stood through everything the fell has, because it lets the wind through instead of arguing with it.",
  },
  {
    id: "the-head-of-the-water",
    title: "The Head of the Water",
    locationId: "sildwater-head",
    regionId: "greyneedle",
    tags: ["water", "roads"],
    body: "This is the same river as the drovers' crossing forty miles south, and you would not put money on it. Here it is four strides across, loud, and in a hurry, and it goes under the road through a timber culvert somebody replaces roughly once a generation. There is a mark cut in the upstream post for every man who has done the replacing — seven of them, the oldest worn to a smudge. Nobody was asked to start that and nobody has been asked to continue it.",
  },

  // --- The Hollowmoor ------------------------------------------------------
  {
    id: "the-thistlebeck-toll",
    title: "The Thistlebeck Toll",
    locationId: "thistlebeck-bridge",
    regionId: "hollowmoor",
    tags: ["custom", "roads"],
    body: "There was a toll on this bridge for a hundred and forty years, and then the family that held the right died out, and the toll simply stopped, because no one could work out who to pay. The little house is still there with its shutter. People leave things on the sill — a coin, a nail, a heel of bread. Not out of fear. Out of the same instinct that makes you thank a door you have caught for somebody. A hundred and forty years is long enough to teach a road a habit.",
  },
  {
    id: "the-nine-at-hollowmoor",
    title: "The Nine at Hollowmoor",
    locationId: "hollowmoor-stones",
    regionId: "hollowmoor",
    tags: ["ruins", "mystery"],
    body: "Nine stones in a ring on open heath, the tallest a little over a man, all of them dragged from a bed of rock eight miles west — which is the only hard fact anybody has, and it is a monstrous one when you stand there and imagine doing it. They are not aligned to the sunrise. People have checked, hopefully, for a century. They are not aligned to anything anyone has found. There are nine, and there is a gap on the north side wide enough for a tenth, and the ground in the gap has never been dug because the moor families will not have it disturbed. Whatever the stones were for, the last person who knew took it with them, and that is the ordinary end of almost everything. We just do not usually have to look at it.",
  },
  {
    id: "the-turf-right",
    title: "The Turf Right",
    locationId: "peat-cuttings",
    regionId: "hollowmoor",
    tags: ["custom", "work"],
    body: "Every house on the moor holds the right to cut one strip of peat, every strip is marked at each end with a stick, and no stick has ever been moved — which is remarkable in a valley that has spent sixty years arguing about one boundary stone in a barley field. Cut in May, stood in June, carried in August, burnt from November: you can date a year off the cuttings more reliably than off any calendar anybody has shown me. The face is eight feet down now. What you are burning is a wood that lay down and never got back up, and it burns very well.",
  },
  {
    id: "the-fires-that-go-out",
    title: "The Fires That Go Out",
    locationId: "hollowmoor-camp",
    regionId: "hollowmoor",
    tags: ["custom"],
    body: "The fires at the Hollowmoor camp go out when anybody comes up the road, and are relit the moment they have gone again. Nobody there will tell you where they are from, and everybody there will feed you, and those two facts belong to each other. It is not a lawless place. It has more rules than Wealdmoot has, and unlike Wealdmoot's they are not written anywhere a magistrate could read them. I play there and I take nothing, and that has been the arrangement since my first year — when I did take something, and did not sleep afterwards, and have never been able to explain to anyone why.",
  },
  {
    id: "the-pipers-cairn",
    title: "The Piper's Cairn",
    locationId: "pipers-cairn",
    regionId: "hollowmoor",
    tags: ["custom", "mystery"],
    body: "A cairn on open moor with no view, no path and nothing to mark but the spot itself — which means somebody died exactly there, and somebody else knew exactly where. They call him the piper. Nobody can tell me what he played, or when, or whether there was ever a man at all. It takes a stone from whoever passes, the same as the Hawkstone up on the March, and the difference between the two is the whole of it: up there you are proving you got that far. Out here you are apologising, on everybody's behalf, for not knowing who he was.",
  },
  {
    id: "the-bield",
    title: "The Bield",
    locationId: "the-bield",
    regionId: "hollowmoor",
    tags: ["custom", "danger"],
    body: "A bield is four short walls built in a cross, no roof, out on ground with nothing else on it, so that whichever way the weather is coming one arm of it is out of the wind. Built for sheep. Used by sheep. Used twice by me, and I would not have come off this fell either time without it. Nobody owns it and nobody maintains it, and the stones that come off get put back by whoever is next past. It is the furthest thing from a house I have ever been grateful to, and I have been very grateful indeed.",
  },

  // --- The long way home ---------------------------------------------------
  {
    id: "the-last-tree",
    title: "The Last Tree",
    locationId: "last-tree",
    regionId: "tarnwild",
    tags: ["trees", "geography"],
    body: "One pine on the north-west shoulder of the Tarnwild, bent double downwind, and beyond it no tree at all for as far as anybody has troubled to walk. It is not the edge of the wood; the wood gave up two miles back. It is the edge of trees, which is a different border and one you can feel standing at. There is a strip of cloth tied to it, and under that knot are older knots, and under those the bark has grown over cloth entirely. Nobody set that going. Everyone who gets this far seems to arrive at it on their own.",
  },
  {
    id: "the-spring-that-moved",
    title: "The Spring That Moved",
    locationId: "sweetwell",
    regionId: "hollowmoor",
    tags: ["water", "mystery"],
    body: "Sweetwell comes up cold on open heath in the middle of four miles of sour ground, tastes of iron, stains the stones orange, and is the only water anybody on this moor will drink. It stopped once, in a summer nobody wanted, and for six weeks the moor carried its water up from the beck. Then it came back — forty paces to the left of where it had been, in ground nobody had ever seen wet. The moor families moved the stones and the cup and the little shrine across to it, and have never discussed it since, in my hearing or, I would guess, in anybody's.",
  },
  {
    id: "the-leaning-shrines",
    title: "The Leaning Shrines",
    locationId: "leaning-shrines",
    regionId: "tarnwild",
    tags: ["custom", "mystery"],
    body: "Two shrines and the stub of a wall out in the Tarnwild, all three leaning the same way, which is the way the wind comes off the fell. There is no village within a day's walk in any direction. Nobody keeps them, nothing carved on them can still be read, and there are always fresh things on the ledges — a coin, a nail, a heel of bread, once a child's shoe. I leave a copper. I could not tell you to whom, or for what. I stopped being embarrassed about that a long time before I stopped doing it.",
  },
  {
    id: "black-water-tarnwild",
    title: "Black Water, Tarnwild",
    locationId: "tarnwild-edge",
    regionId: "tarnwild",
    tags: ["water", "danger"],
    body: "The tarns out here look like ink and are perfectly clear; it is peat under them and no weed in them, so there is nothing for the light to come back off. That is the whole of the mystery and it does not help at all when you are standing over one. Nothing lives in them worth the catching. The pines come right to the edge and lean, and the wind up there sounds like a room of people two valleys away. West of anywhere a sensible person has business being, they say in the villages, and they are right, and I keep coming anyway.",
  },
  {
    id: "somebodys-fire",
    title: "Somebody's Fire",
    locationId: "wolfpine-camp",
    regionId: "tarnwild",
    tags: ["custom", "roads"],
    body: "There has been a fire ring in this clearing for longer than the villages have been down the hill, and it is never quite cold. That is not a ghost. That is a hundred and fifty miles of empty country with one decent sheltered spot in it, and everyone crossing agreeing without ever having met that you leave dry wood stacked and you leave the ring clean. I have arrived here shaking and found kindling under a stone, put there by a person I will never meet, for a person they would never meet. If you want to know what I think holds a country together, it is not the roads.",
  },
  {
    id: "the-lantern-at-duskpool",
    title: "The Lantern at Duskpool",
    locationId: "duskpool",
    regionId: "wanderers-green",
    tags: ["ghosts", "custom"],
    body: "There is a hook on the alder at the water's edge, and most nights there is a lantern on the hook. Nobody in the Green will say they hang it. They will say it has always been hung, which is a different sentence and they know it. The story is that a girl waited here for a man off the north road, and kept a light going for him, and got old at it. The kinder version is that somebody simply decided a black pool on a dark road wanted a light, and their children carried on. I have sung both. The second one empties the room slower.",
  },
];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The lore a place unlocks. Entries with no location are included everywhere —
 * that is what an override with no `location:` directive means, and it is the
 * behaviour a project that does not use this world wants.
 */
export function loreFor(
  locationId: string | undefined,
  catalogue: LoreEntry[] = DEFAULT_LORE
): LoreEntry[] {
  return catalogue.filter(
    (entry) => !entry.locationId || (!!locationId && entry.locationId === locationId)
  );
}

export function loreInRegion(
  regionId: string,
  catalogue: LoreEntry[] = DEFAULT_LORE
): LoreEntry[] {
  return catalogue.filter((entry) => entry.regionId === regionId);
}

export function loreById(
  id: string,
  catalogue: LoreEntry[] = DEFAULT_LORE
): LoreEntry | undefined {
  return catalogue.find((entry) => entry.id === id);
}

/**
 * The catalogue grouped by region, in catalogue order, for a journal screen.
 *
 * Seventy-six entries is too many for one list and exactly right for fourteen
 * short ones, and a player who has walked the west of the map wants to see the
 * west of the map fill up. Entries with no region — which is every project
 * override that did not declare one — are collected under the empty string, so
 * nothing is silently dropped from a UI that iterates this.
 */
export function loreByRegion(
  catalogue: LoreEntry[] = DEFAULT_LORE
): Record<string, LoreEntry[]> {
  const grouped: Record<string, LoreEntry[]> = {};
  for (const entry of catalogue) {
    const key = entry.regionId ?? "";
    const bucket = grouped[key] ?? (grouped[key] = []);
    bucket.push(entry);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Project overrides
// ---------------------------------------------------------------------------

/** A row of the `lore_docs` table. */
export type ProjectLoreDoc = {
  id?: string | null;
  title?: string | null;
  body?: string | null;
};

/** Lays a project's `lore_docs` rows over `DEFAULT_LORE`. */
export function resolveLore(
  projectLoreDocs: ProjectLoreDoc[] | null | undefined,
  options: ResolveOptions = {}
): LoreEntry[] {
  const rows = (projectLoreDocs || []).filter((row) => (row?.title || "").trim());

  const overrides = new Map<string, ProjectLoreDoc>();
  for (const row of rows) overrides.set(slug(row.title as string), row);

  const toEntry = (row: ProjectLoreDoc, base?: LoreEntry): LoreEntry => {
    const { meta, body } = parseDirectives(row.body || "");
    const tags = splitList(meta.tags);
    return {
      id: base?.id ?? slug(row.title as string),
      title: (row.title as string).trim(),
      body: body || base?.body || "",
      locationId: meta.location ?? base?.locationId ?? "",
      regionId: meta.region ?? base?.regionId,
      tags: tags.length ? tags : base?.tags,
      origin: "project",
      rowId: row.id || undefined,
    };
  };

  if (options.mode === "replace") return rows.map((row) => toEntry(row));

  const merged: LoreEntry[] = DEFAULT_LORE.map((entry) => {
    const row = overrides.get(slug(entry.title)) ?? overrides.get(entry.id);
    if (!row) return { ...entry, origin: "default" as const };
    overrides.delete(slug(entry.title));
    overrides.delete(entry.id);
    return toEntry(row, entry);
  });

  for (const row of rows) {
    const key = slug(row.title as string);
    if (!overrides.has(key)) continue;
    overrides.delete(key);
    merged.push(toEntry(row));
  }

  return merged;
}
