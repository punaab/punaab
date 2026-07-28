/**
 * Where Punaab goes, and what he says when he gets there.
 *
 * The first itinerary was six stops on one road loop, which read as a man on a
 * treadmill. The second was thirty-one, which was a tour but still left two
 * thirds of the map as scenery he walked past. This is seventy-six: every one
 * of the eleven settlements, every one of the fourteen named regions, and the
 * wild ground in between — a spring, a cairn, a wreck, a burnt farmstead, a
 * boundary stone, a fungus ring, a drowned village you can only see in a dry
 * year, a hermit's cell, a battlefield nobody can name, and a field of bees
 * that has just been told somebody died.
 *
 * The rule that governs every entry: **arriving somewhere has to be worth it.**
 * A destination is not a waypoint with ambience attached. It is a specific
 * thing standing in a specific place, and what he says on arrival is about
 * that thing and could not be said anywhere else in the valley. If a line
 * would work at two destinations, it belongs at neither.
 *
 * Each destination carries:
 *   - `lines`    what he says on arrival, in his voice, particular to the place
 *   - `loreId`   the `lore.ts` entry that place unlocks
 *   - `questId`  the `quests.ts` errand he offers there
 *   - `waresTag` which pack comes off his shoulder (see `wares.ts`)
 *   - `songId`   what he plays, where he plays
 *   - `landmark` the kind of structure he came to stand at, for `landmarkAt`
 *
 * Those are ids, not objects, on purpose: a project that has replaced the lore
 * and the wares still gets a working itinerary, and the three content modules
 * stay independently overridable. Resolve them with `loreById`, `questById`
 * and `waresFor` against the *resolved* catalogues, not the defaults.
 *
 * -------------------------------------------------------------------------
 * FOR GAME DEVELOPERS
 * -------------------------------------------------------------------------
 * This table is the one piece of Punaab's world that is not overridable from
 * the database, because it is world *geometry* — it only means anything against
 * this terrain. If you are dropping him into your own game, ignore it: drive
 * him from your own waypoints and use `resolveWares` / `resolveLore` /
 * `resolveQuests` for what he carries and knows. `GET /api/v1/world` serves
 * this table so your game can mirror the valley if you want it, or read where
 * he is if you want him to be somewhere real while your player is elsewhere.
 *
 * Determinism: no `Math.random` in this file. Arrival lines are chosen by an
 * integer hash of the destination id and the visit number, so two clients
 * watching the same bard hear the same sentence.
 */

import { REGIONS, regionAt } from "@/lib/world/regions";
import { SETTLEMENTS, STRUCTURES } from "@/lib/world/settlements";
import type { Structure, StructureKind } from "@/lib/world/settlements";

export type DestinationActivity =
  | "travelling"
  | "performing"
  | "trading"
  | "talking"
  | "resting"
  | "wondering"
  | "discovering";

export type Destination = {
  id: string;
  name: string;
  x: number;
  z: number;
  activity: DestinationActivity;
  /** Seconds he stays. */
  dwell: number;
  lines: string[];
  songId?: string;
  /** Lore unlocked on arrival. */
  loreId?: string;
  /** Quest offered here. */
  questId?: string;
  /** What he trades here. Omitted where he only has his standing stock. */
  waresTag?: string;
  /**
   * What he came to stand next to.
   *
   * A *filter*, not a coordinate: `settlements.ts` decides where its structures
   * actually end up, so naming the kind here and letting `landmarkAt` find the
   * nearest one of that kind survives the placer moving a windmill four metres
   * left. Omitted where the place is the landmark and nothing was built on it.
   */
  landmark?: StructureKind;
  /** Resolved from `SETTLEMENTS` at load. Never hand-written. */
  settlementId?: string;
  /** Resolved from `REGIONS` at load. Never hand-written. */
  regionId?: string;
};

/**
 * The round, in order.
 *
 * Ordering is a real constraint, not a list: consecutive entries are the legs
 * he actually walks, so a badly ordered table sends him back and forth across
 * the valley all day. It runs east out of the Green to the sister stones, west
 * through the field country, out to the last milestone, down the mere to the
 * strand, east through the orchards and Elderloom, across the fen to the
 * eastern gap, back through Bracken Hollow, north up the badlands to the March,
 * west along the pine country to the snows, and home down the moor and the
 * Tarnwild. Seventy-six stops, roughly 4.4 kilometres of walking, and no leg
 * longer than the two hundred metres of empty between Wolfpine and Duskpool —
 * which is empty in the world too, and is supposed to feel like it.
 *
 * Coordinates are hand-placed and then checked against the six water bodies in
 * `terrain.ts`: those shorelines are perturbed outward by up to a fifth of
 * their radius, so "just outside the nominal circle" is not far enough, and
 * every entry below clears the *widest* shore each water can reach.
 */
const TOUR: Destination[] = [
  // --- Wanderer's Green, and the town in the middle of it -------------------
  {
    id: "wanderers-cross",
    name: "The Wanderer's Cross",
    x: 4,
    z: 18,
    activity: "talking",
    dwell: 50,
    landmark: "signpost",
    loreId: "the-long-circuit",
    lines: [
      "The signpost has four arms and three of them are right. I'll let you work out which.",
      "Everything in this valley comes through here eventually. Including me, apparently. Forever.",
      "Ah — company. Walk a while. I don't charge for that.",
      "Back at the cross. Eleven times now. I keep expecting it to look different.",
    ],
  },
  {
    id: "sister-stones",
    name: "The Sister Stones",
    x: 70,
    z: -52,
    activity: "discovering",
    dwell: 60,
    waresTag: "curio",
    landmark: "standing_stones",
    loreId: "the-sister-stones",
    lines: [
      "Eight standing, one on its back. The one on its back is the only one anybody ever cut anything into.",
      "They're called the sisters. There is no story about any sisters. There is only the word, and the word is older than the town.",
      "Close enough to Wealdmoot that the children play in here. Far enough that nobody's mother comes to look.",
      "Stand in the middle and shout. Nothing happens. I check every year, and I have started to enjoy it not happening.",
    ],
  },
  {
    id: "crowfoot",
    name: "Crowfoot Gate",
    x: 96,
    z: -18,
    activity: "talking",
    dwell: 55,
    waresTag: "farm",
    landmark: "barn",
    loreId: "the-crowfoot-lease",
    lines: [
      "Barn's newer than the house and twice the size of it. You can read a family's priorities off a yard in about four seconds.",
      "They won't ask me in. They bring the bread out to the gate and stand there while I eat it, which is a different kindness, and I'll take it.",
      "Three generations on a lease with nine years left to run. Nobody in that house talks about year ten.",
      "The dog knows me now. That took four years. I was very patient and it was not.",
    ],
  },
  {
    id: "wealdmoot-market",
    name: "The Wealdmoot Market",
    x: 10,
    z: 34,
    activity: "trading",
    dwell: 80,
    songId: "until-it-leads-me-home",
    waresTag: "market",
    landmark: "market_stall",
    loreId: "the-market-peace",
    questId: "what-the-scales-say",
    lines: [
      "Only market in the valley, and everything on it came from somewhere I've walked. I could tell you which stall lies. Not standing in the middle of it.",
      "Stand near the pie and play. That is the entire craft. Everything else I might tell you about this trade is decoration.",
      "Market peace holds from the bell to the bell. You may say what you like in here and nobody is permitted to answer it until dusk.",
      "Two coppers for the song. — No. Two coppers for the song, and I won't sing it at your brother's stall after.",
    ],
  },
  {
    id: "moot-bench",
    name: "The Moot Bench",
    x: -8,
    z: 54,
    activity: "talking",
    dwell: 55,
    waresTag: "market",
    loreId: "the-moot-bench",
    lines: [
      "One long stone bench, and a magistrate who sits on it twice a month and would rather not.",
      "Everything is heard out here in the open. No door means no room to be taken into. That was decided after something, and nobody will tell me after what.",
      "I have watched a man lose a field on this bench and then shake the hand of the man who took it. That is either civilisation or it is very good acting.",
      "Best free entertainment between here and the coast, and I say that with my hat off.",
    ],
  },
  {
    id: "longmead-mill",
    name: "Longmead Mill",
    x: 44,
    z: 72,
    activity: "trading",
    dwell: 70,
    waresTag: "farm",
    landmark: "windmill",
    loreId: "the-millers-tenth",
    lines: [
      "Wind mill, not water — the beck out here is a rumour. Sails come off in October and go back on in March, and everyone pretends that's a decision rather than the weather.",
      "The miller takes a tenth. Everybody says he takes a ninth. He has taken a tenth for thirty years and he will die accused.",
      "You can hear the stones from the road. When they stop you look up without meaning to.",
      "Good flour. Terrible company. I'd make that trade anywhere.",
    ],
  },
  {
    id: "three-parish-stone",
    name: "The Three-Parish Stone",
    x: -48,
    z: 40,
    activity: "wondering",
    dwell: 45,
    loreId: "the-three-parish-stone",
    questId: "walking-the-bounds",
    lines: [
      "Three parishes meet on this stone and all three of them count it as theirs, which is impressive arithmetic.",
      "Three grooves cut in the top, one facing each way. Somebody had to agree to that. I would have liked to watch that meeting and I would not have liked to be in it.",
      "They beat the bounds at Rogation and they bump a boy's head on this stone so he remembers where the line runs. He does. That's the bleak part. It works.",
      "It is a rock in a hedge. It has ended two marriages.",
    ],
  },

  // --- Barleyhearth and the field country ----------------------------------
  {
    id: "hearthwick",
    name: "Hearthwick",
    x: -66,
    z: 112,
    activity: "resting",
    dwell: 65,
    waresTag: "farm",
    landmark: "well",
    loreId: "the-well-at-hearthwick",
    lines: [
      "One farm, one well, and that well is the only one on this road that did not go dry in the bad four years.",
      "There's a lid on it and a cup beside it and they have never charged anybody a thing. I asked why once. They looked at me the way you'd look at a man asking why the sky.",
      "I sleep in that barn when they let me, which is always, which is why I only ask about once a year.",
    ],
  },
  {
    id: "liars-acre-hedge",
    name: "The Hedge on Liar's Acre",
    x: -84,
    z: 80,
    activity: "wondering",
    dwell: 50,
    waresTag: "farm",
    landmark: "fence",
    loreId: "what-the-hedge-remembers",
    lines: [
      "There's the bend. Sixty years of hedge grown over a lie, and the hedge does not care, and it is the only thing out here that doesn't.",
      "A hedge remembers where it was laid. Sight along it from the low end and you'll see where it still thinks the line is.",
      "Both families walk this hedge. Neither family walks it at the same time. There is a rota. Nobody wrote the rota down.",
      "Don't say the name out loud with a house in sight. I mean that kindly.",
    ],
  },
  {
    id: "barleyhearth",
    name: "Barleyhearth",
    x: -95,
    z: 66,
    activity: "trading",
    dwell: 75,
    waresTag: "farm",
    loreId: "the-naming-of-fields",
    questId: "liars-acre",
    songId: "until-it-leads-me-home",
    lines: [
      "Two coppers for the song and I'll throw in the map. — No? One copper, and you can keep your own counsel about the map.",
      "Every field here has a name and every name is a lawsuit.",
      "Don't say Liar's Acre in the taproom. Say it outside. Quietly. To me.",
      "They feed me here. That's most of why I come, and they know it, and they do it anyway.",
    ],
  },
  {
    id: "sildwater-ford",
    name: "The Drovers' Crossing",
    x: -107,
    z: 47,
    activity: "resting",
    dwell: 70,
    waresTag: "farm",
    landmark: "bridge",
    loreId: "the-drovers-crossing",
    lines: [
      "Bridge sits three feet higher than the water has ever come. That's not confidence. That's an apology.",
      "There was a ford here first, and a man with a pole to tell you whether today was a day for it.",
      "Sit on the parapet a moment. My feet have opinions.",
    ],
  },
  {
    id: "oxleaze",
    name: "Oxleaze",
    x: -124,
    z: 14,
    activity: "resting",
    dwell: 60,
    waresTag: "farm",
    landmark: "barn",
    loreId: "the-oxleaze-team",
    lines: [
      "Ox pasture, and there hasn't been an ox in it since before I started walking. They kept the name and sold the beasts, in that order.",
      "See the bare ring by the gate, where the team used to stand and wait? Grass still won't take it back.",
      "The old man here can still name all eight of them. He'll do it if you let the silence run long enough, and then he changes the subject himself.",
    ],
  },
  {
    id: "ashcroft",
    name: "Ashcroft",
    x: -146,
    z: 36,
    activity: "discovering",
    dwell: 60,
    waresTag: "curio",
    landmark: "ruin",
    loreId: "the-burning-of-ashcroft",
    questId: "who-lived-at-ashcroft",
    lines: [
      "Four walls, no roof, and an apple tree in what used to be the yard still doing its job every autumn for nobody at all.",
      "Fire was thirty years back. The well was filled in afterwards, with stone, deliberately, and that is the part nobody will explain to me.",
      "Nobody rebuilt and nobody ploughed it. In this valley that is a sentence, not an omission.",
      "I've slept in the lee of that gable twice. Both times I was up before light and I could not entirely tell you why.",
    ],
  },
  {
    id: "mirrormere-shore",
    name: "The North Shallows",
    x: -176,
    z: 40,
    activity: "performing",
    dwell: 90,
    songId: "until-it-leads-me-home",
    waresTag: "shore",
    loreId: "the-drowned-lane",
    questId: "long-lane",
    lines: [
      "Water carries a voice better than any hall I've sung in.",
      "It's low this year. Low enough to see the lane. That happens twice in a life.",
      "There's a road under there with hedges on it. Sit with that a while.",
    ],
  },
  {
    id: "westward-mile",
    name: "The Last Milestone",
    x: -288,
    z: 96,
    activity: "wondering",
    dwell: 45,
    loreId: "the-last-milestone",
    questId: "the-last-milestone",
    lines: [
      "Eleven miles, it says. It doesn't say to what.",
      "Road gives out in the bracken two hundred paces on. Doesn't taper. Just stops.",
      "I put my hand on it every time I come out here. Grown man. I know.",
      "Somebody carried this to the edge of the map and set it down facing away from home.",
    ],
  },

  // --- The mere, the strand and the quay -----------------------------------
  {
    id: "underlyme",
    name: "Underlyme",
    x: -232,
    z: 168,
    activity: "performing",
    dwell: 85,
    songId: "until-it-leads-me-home",
    waresTag: "shore",
    loreId: "underlyme",
    questId: "the-gable-count",
    lines: [
      "Low water this year. Those are gable ends you're looking at, not rocks. Count them if you like. Everybody does it once.",
      "It drowned slowly enough that they carried the doors out with them. There isn't a door down there. Go and look.",
      "The tall one is the church. It's shorter than it was. People take the stone.",
      "I'll play the river song here and I'll take nothing for it. Not here.",
    ],
  },
  {
    id: "low-strand",
    name: "The Low Strand",
    x: -208,
    z: 258,
    activity: "discovering",
    dwell: 55,
    waresTag: "shore",
    loreId: "what-the-strand-keeps",
    lines: [
      "Everything the mere takes washes up on this corner eventually. Oars. Hats. A whole door, once.",
      "You may keep what you find. But it lies out on the shingle one night first, in case it's being looked for.",
      "Nobody has ever come back for anything. They still leave it out.",
    ],
  },
  {
    id: "ninefoot-wreck",
    name: "The Ninefoot",
    x: -190,
    z: 230,
    activity: "wondering",
    dwell: 50,
    waresTag: "shore",
    loreId: "the-ninefoot",
    lines: [
      "Nine feet of boat up on the shingle with her ribs showing, like something that lay down on purpose.",
      "She has been here longer than the oldest man who can name her. Somebody tars the stem every spring. Only the stem.",
      "You can read a name off the transom in a low sun, from one angle exactly. I'll not tell you it. You should have to lie down on wet stones for it, the way I did.",
    ],
  },
  {
    id: "saltmere-strand",
    name: "Saltmere Strand",
    x: -158,
    z: 196,
    activity: "trading",
    dwell: 75,
    waresTag: "shore",
    landmark: "dock",
    loreId: "the-salt-on-the-west-wind",
    questId: "the-salt-count",
    lines: [
      "Salt on the rocks and fresh water under them. Four hundred years of shrugging.",
      "I'll buy a pint of it here and sell it in the hills for four times the money. That's the whole trade, and I'm not ashamed of it.",
      "Wind's got west in it. There'll be salt by morning.",
    ],
  },
  {
    id: "mere-lamp",
    name: "The Lamp on the Quay",
    x: -138,
    z: 192,
    activity: "performing",
    dwell: 90,
    songId: "until-it-leads-me-home",
    waresTag: "shore",
    landmark: "lighthouse",
    loreId: "the-lamp-that-is-still-lit",
    questId: "whose-boat",
    lines: [
      "There's a lamp on that post and it is lit every night of the year, and no boat has come in off this water in nineteen years.",
      "The oil is a parish charge. It goes through the accounts as 'the lamp'. Nobody itemises it and nobody has ever queried it.",
      "Nets on every fence and not a boat on the water. Have a look at how well the nets are kept.",
      "I sing the lantern song here, and quietly, because the woman who lights it can hear the quay from her kitchen and she is not sentimental about herself.",
    ],
  },

  // --- Cidergarth ----------------------------------------------------------
  {
    id: "bee-garth",
    name: "The Bee Garth",
    x: -84,
    z: 208,
    activity: "talking",
    dwell: 60,
    waresTag: "orchard",
    loreId: "telling-the-bees",
    questId: "a-name-for-the-bees",
    lines: [
      "Forty skeps in rows, and a black ribbon on the end one. Somebody in the garth has died, and the bees have been told.",
      "You tell them out loud, by name, and you knock on the hive first, because it is rude to begin without knocking. I have never once heard anybody laugh at it.",
      "The bees do the orchards. No bees, no apples, no cider, no village. The custom is not superstition. It is an accounts department with a ribbon on it.",
      "Walk slowly. They know the pace of everyone who belongs here, and I am tolerated on a technicality.",
    ],
  },
  {
    id: "mother-of-apples",
    name: "The Mother of Apples",
    x: -80,
    z: 246,
    activity: "talking",
    dwell: 60,
    waresTag: "orchard",
    landmark: "shrine",
    loreId: "the-mother-of-apples",
    lines: [
      "One tree. Nine hundred acres wide, if you count it honestly.",
      "Three posts and a leather strap holding up the grandmother of every orchard in the garth.",
      "She has the only job in this valley with no retirement in it. She's training her niece already.",
    ],
  },
  {
    id: "long-row",
    name: "The Long Row",
    x: -62,
    z: 240,
    activity: "talking",
    dwell: 55,
    waresTag: "orchard",
    loreId: "the-long-row",
    lines: [
      "Every tree in this row has a name and every name was a person. You plant one when somebody goes.",
      "So the row is a burial ground that gives you forty pounds of fruit a year. I spent a long time deciding whether that was beautiful or simply practical. It's both. That's allowed.",
      "Third from the end is a child's. You can tell, because it is the best-pruned tree in the garth.",
    ],
  },
  {
    id: "cidergarth",
    name: "Cidergarth",
    x: -50,
    z: 210,
    activity: "trading",
    dwell: 80,
    waresTag: "orchard",
    loreId: "the-blackjack-year",
    questId: "a-cutting-for-the-hollow",
    lines: [
      "Careful with the black stuff. One measure settles an argument. Two starts a better one.",
      "They drank forty years of reserve in a single summer, and the trees came back anyway, which taught them nothing.",
      "Everyone here owes everyone else a barrel. You'll hear about it before your cup's empty.",
    ],
  },
  {
    id: "appleyard",
    name: "Appleyard",
    x: -20,
    z: 248,
    activity: "trading",
    dwell: 70,
    waresTag: "orchard",
    landmark: "barn",
    loreId: "the-windfall-right",
    lines: [
      "Windfalls belong to whoever picks them up. Everything still on the tree belongs to the man who owns the tree. That is the whole of orchard law and it has never needed a second line.",
      "Which is why you'll see people out here before light after a gale. That's not theft. That's weather.",
      "They'll sell me a bottle at the door and not let me past it. Fair enough. I've a lute and no shoes worth the name.",
    ],
  },

  // --- Elderloom -----------------------------------------------------------
  {
    id: "fairy-ring",
    name: "Ganger's Ring",
    x: 24,
    z: 224,
    activity: "discovering",
    dwell: 55,
    waresTag: "wood",
    loreId: "the-ring-in-gangers-meadow",
    questId: "measure-the-ring",
    lines: [
      "A ring of mushrooms forty paces across, in the same meadow it was in when I was young and about six paces further north.",
      "It's one fungus. One. Growing outward from a dead stump since before the parish had a name, and the ring is only where it has got to.",
      "I've told people that. They nod. Then they walk round it rather than through it, and so, in all honesty, do I.",
      "Don't sleep in it. Not for any reason you're thinking of. The ground in the middle is wet.",
    ],
  },
  {
    id: "deer-leap",
    name: "The Deer Leap",
    x: 30,
    z: 168,
    activity: "wondering",
    dwell: 50,
    waresTag: "wood",
    loreId: "the-deer-leap",
    lines: [
      "Bank on one side, ditch on the other. A deer can come in over it. A deer cannot get back out over it.",
      "Somebody's park, five hundred years ago. No house left, no family left, and eleven miles of earth bank that will outlast the road.",
      "The deer are still here. The deer won that one. By waiting.",
    ],
  },
  {
    id: "elderloom-hall",
    name: "Elderloom",
    x: 56,
    z: 188,
    activity: "performing",
    dwell: 90,
    songId: "until-it-leads-me-home",
    waresTag: "wood",
    loreId: "the-wood-that-answers",
    questId: "what-the-wood-said",
    lines: [
      "The canopy shuts over the road here. Sing into it and it hands you back something you're fairly sure you didn't say.",
      "Good acoustics. Poor company. I'll take the trade.",
      "Eleven people have told me what this wood says. Eleven different sentences.",
    ],
  },
  {
    id: "willowpond",
    name: "Willowpond",
    x: 88,
    z: 200,
    activity: "resting",
    dwell: 80,
    waresTag: "wood",
    loreId: "the-willow-count",
    questId: "the-eleventh-willow",
    lines: [
      "Eleven willows. They count them out loud every Candlemas, with a boy sent round the far side to be sure.",
      "It's ten this year. Nobody has said so out loud yet.",
      "Quiet spot. I'll sit here until my feet forgive me.",
    ],
  },
  {
    id: "colliers-hearth",
    name: "The Colliers' Hearth",
    x: 108,
    z: 156,
    activity: "resting",
    dwell: 65,
    waresTag: "wood",
    loreId: "the-charcoal-burners",
    lines: [
      "Flat black circle in the leaf mould, twelve paces across. Nothing grows on it and nothing will inside a lifetime.",
      "A burn is a week without sleep. You sit up with the stack, and if you nod off it goes to flame, and a week's work is smoke.",
      "They build a hut of turf and take it in turns to lie down in it. That is the whole of the life. There are three men left in this valley who can do it.",
      "Still warm, if you put your hand flat on it. That's the sun on black ground. It is, though. Isn't it.",
    ],
  },

  // --- Thornwake Fen -------------------------------------------------------
  {
    id: "sedge-cut",
    name: "The Sedge Cut",
    x: 140,
    z: 160,
    activity: "trading",
    dwell: 70,
    waresTag: "fen",
    loreId: "the-reed-year",
    lines: [
      "Cut in winter, on the ice if you're lucky, and everything you own is wet from December to March.",
      "Reed off this cut roofs half the valley and outlives the man who laid it by thirty years. Ask a thatcher how he feels about that. Then stand back.",
      "The cut moves. Four-year turn, worked in strips, and if you skip a strip the fen takes it back and there is no negotiating that.",
    ],
  },
  {
    id: "fenreed",
    name: "Fenreed",
    x: 166,
    z: 146,
    activity: "performing",
    dwell: 85,
    songId: "until-it-leads-me-home",
    waresTag: "fen",
    landmark: "dock",
    loreId: "the-firm-ground",
    questId: "sounding-the-ground",
    lines: [
      "Built on the only firm ground for a mile, and every spring somebody walks the whole boundary with a pole to check that it still is.",
      "Punts are tied at the back doors, not the front. That tells you which way they expect to leave.",
      "Good room for a voice, this. Water on three sides and nothing tall to eat the sound.",
      "They've moved this hamlet twice. Same name both times. Same families. Same argument.",
    ],
  },
  {
    id: "fenmere-edge",
    name: "The Fenmere Edge",
    x: 208,
    z: 118,
    activity: "wondering",
    dwell: 45,
    waresTag: "fen",
    loreId: "the-causeway-markers",
    lines: [
      "Forty-one posts, and the last house at each end lights them. No fee, and no getting out of it.",
      "Count them as you pass. If you get thirty-nine, you missed two, and it's the two you missed that mattered.",
      "It isn't deep. That was never the problem with it.",
    ],
  },

  // --- The Sunder Flats and the eastern gap --------------------------------
  {
    id: "hallowfield",
    name: "Hallowfield",
    x: 272,
    z: 146,
    activity: "wondering",
    dwell: 55,
    waresTag: "moor",
    loreId: "hallowfield",
    questId: "whose-battle",
    lines: [
      "Flat ground, a ditch that is not a field ditch, and a name that means the field of the dead in a language nobody here speaks.",
      "The plough turns things up. Buckles, mostly. One helmet in my lifetime, and it went for scrap, because it was iron and the man needed a hinge.",
      "Nobody can tell me who fought here or which side we were. Both, probably. That is how it usually goes on a road like this one.",
      "Nothing grows badly here. People find that the hard part. They want the grass to know.",
    ],
  },
  {
    id: "east-gap",
    name: "The Eastern Gap",
    x: 298,
    z: 178,
    activity: "wondering",
    dwell: 45,
    loreId: "the-gap-that-was-left",
    lines: [
      "Valley behind you, and a great deal of nothing ahead. Every trader, army and plague we ever had came through this notch.",
      "Post sockets cut in the rock, a cart's width apart. There was a gate here.",
      "Nobody's thought it worth rebuilding in living memory. Make of that what you like.",
    ],
  },
  {
    id: "farrows-try",
    name: "Farrow's Try",
    x: 238,
    z: 262,
    activity: "discovering",
    dwell: 55,
    waresTag: "moor",
    loreId: "farrows-try",
    lines: [
      "Somebody ploughed the flats. Once. Get low and you can still see the furrows — dead straight for three hundred paces, and then they stop mid-row.",
      "There's a hearth stone, four post holes, and a lease in the Wealdmoot book with eleven years left unpaid on it.",
      "I don't laugh at Farrow. Everyone I have ever met who did was standing on ground somebody else broke first.",
    ],
  },
  {
    id: "sunder-flats",
    name: "The Sunder Flats",
    x: 248,
    z: 212,
    activity: "discovering",
    dwell: 50,
    waresTag: "moor",
    loreId: "how-the-fen-drains",
    lines: [
      "All the wet in the east leaves through here. One flat wide hiss, and not a waterfall in it anywhere.",
      "It isn't empty because nothing grows. It's empty because everything that grew went east, an inch at a time.",
      "Firm ground. Worth more than it sounds, after the fen.",
    ],
  },
  {
    id: "sunder-watch",
    name: "The Sunder Watch",
    x: 206,
    z: 216,
    activity: "wondering",
    dwell: 50,
    waresTag: "curio",
    landmark: "ruin",
    loreId: "the-sunder-watch",
    lines: [
      "Two walls and a doorway, looking east down the only road in. Somebody sat here every night for a long time.",
      "There's a hearth in the corner and it has been used since. Recently, by the smell of it. Not by me.",
      "Whoever built this was watching for something coming in through the gap. Whoever uses it now is watching for something going out.",
    ],
  },
  {
    id: "fen-bell",
    name: "The Fen Bell",
    x: 196,
    z: 96,
    activity: "resting",
    dwell: 60,
    waresTag: "fen",
    loreId: "the-fen-bell",
    questId: "ring-it-anyway",
    lines: [
      "A bell on a post at the fen's edge. The rule is you ring it when the fog comes down and you keep ringing until whoever is out there is in.",
      "It has no rope. The rope is kept in the house so children can't play with it, and the house is forty paces off, and forty paces in fog is a decision.",
      "They ring it once a year for every man the fen has had. That takes most of an afternoon, and it is the longest hour I have ever stood through.",
    ],
  },
  {
    id: "fen-causeway",
    name: "The Thornwake Causeway",
    x: 150,
    z: 118,
    activity: "travelling",
    dwell: 25,
    waresTag: "fen",
    loreId: "why-nobody-crosses-thornwake",
    questId: "forty-one-posts",
    lines: [
      "Keep to the stones. That's the whole law out here, and it has never needed a second line.",
      "It isn't haunted. It's fair. Fair the way a cliff is fair.",
      "That island you're steering by will be open water by autumn. So don't.",
    ],
  },

  // --- Bracken Hollow ------------------------------------------------------
  {
    id: "hollow-orchard",
    name: "The Hollow Orchard",
    x: 146,
    z: 50,
    activity: "discovering",
    dwell: 60,
    waresTag: "orchard",
    loreId: "the-hollow-orchard",
    lines: [
      "Sixty trees and not one of them under seventy years old, and nobody under fifty left in the parish to prune them.",
      "Cut an old apple open and it's a chimney with bark on it. They'll bear like that for another twenty years and then go over in one gale, all of them, in the same week.",
      "The garth will give a cutting off the mother tree to anyone who'll walk it out here. I've said so in four villages. Somebody will. Probably not this year.",
    ],
  },
  {
    id: "keep-ditch",
    name: "The Keep Ditch",
    x: 108,
    z: 44,
    activity: "wondering",
    dwell: 50,
    waresTag: "curio",
    landmark: "ruin",
    loreId: "the-keep-ditch",
    lines: [
      "The ditch is the building. Everything above ground was carried off for barns and doorsteps inside a generation of the last man leaving.",
      "You can walk the whole plan of it in two minutes. Hall there. Gate there. Somebody's kitchen, just there.",
      "Nobody local will say who held it or against whom, and I have stopped believing that is ignorance.",
    ],
  },
  {
    id: "bracken-hollow",
    name: "Bracken Hollow",
    x: 126,
    z: 26,
    activity: "trading",
    dwell: 70,
    waresTag: "wood",
    loreId: "the-warm-hollow",
    lines: [
      "First green in the valley and the last leaf to let go. It's only a dip with a hill on the cold side.",
      "Shout before you cut through the bracken. It's polite, and it's also practical.",
      "They used to bring sick children here. It's just warm. Sometimes that was enough.",
    ],
  },
  {
    id: "wintergreen-bank",
    name: "Wintergreen Bank",
    x: 160,
    z: 10,
    activity: "resting",
    dwell: 60,
    waresTag: "wood",
    loreId: "the-fever-slope",
    lines: [
      "South-facing, hill at its back, out of the wind entirely. Green here in February. That is geography, not a miracle — and it was a miracle to people who needed one.",
      "They carried sick children up this bank and sat in the sun with them. Some of them got better. Some of them were going to anyway.",
      "There's a flat stone worn hollow where the sitting was done. That is the only monument here and it is the one I'd have chosen.",
    ],
  },

  // --- Ashenreach ----------------------------------------------------------
  {
    id: "red-quarry",
    name: "The Red Quarry",
    x: 158,
    z: -84,
    activity: "discovering",
    dwell: 60,
    waresTag: "stone",
    landmark: "quarry",
    loreId: "why-the-stone-runs-red",
    questId: "the-quarry-lamp",
    lines: [
      "Iron in the rock, rusting for an age and a half. That is all it is.",
      "The other version has a battle in it. It isn't true. It fits a tune better, and I've eaten off that difference for twenty years.",
      "There's a lamp down under that red water. They won't fetch it up and they won't let it be forgotten.",
    ],
  },
  {
    id: "blackrun-crossing",
    name: "The Blackrun Crossing",
    x: 184,
    z: -96,
    activity: "resting",
    dwell: 55,
    waresTag: "stone",
    landmark: "bridge",
    loreId: "the-blackrun-bridge",
    lines: [
      "Single span, no parapet. A parapet catches wind, and this crossing gets wind the way a bell gets a hammer.",
      "Flood mark's on the abutment there. It's above your head. Don't dwell on it.",
      "Cross it when it's quiet, and don't stop in the middle to look, whatever your legs tell you.",
    ],
  },
  {
    id: "ashen-hold",
    name: "The Ashen Hold",
    x: 194,
    z: -80,
    activity: "wondering",
    dwell: 65,
    waresTag: "curio",
    landmark: "watchtower",
    loreId: "the-ashen-hold",
    questId: "the-name-of-the-watch",
    lines: [
      "Burned from the inside, and the door barred from within. You can read that off the walls yourself.",
      "Someone watched this road for a hundred years. Nobody remembers their name.",
      "There's a stair down under the yard. I've stood at the top of it with a lantern more than once.",
      "I always find a reason to be somewhere else by nightfall.",
    ],
  },
  {
    id: "the-delve",
    name: "The Ashenreach Delve",
    x: 206,
    z: -120,
    activity: "trading",
    dwell: 75,
    waresTag: "stone",
    landmark: "quarry",
    loreId: "what-the-delve-owes",
    questId: "the-ore-road",
    lines: [
      "Red stone out, water in, and the pit has been winning since the old king died. They still cut. It's what the hands know how to do.",
      "There's ore in the bottom galleries. Good ore. It will not weld. The best smith in this valley has broken four hammers proving that to himself.",
      "Everybody here is owed wages by somebody who is also owed wages. It has gone on so long they stopped calling it a debt and started calling it the delve.",
      "Buy the whetstone. Not off me — off the shed. They need it more, and it's the same stone.",
    ],
  },
  {
    id: "ashgate-watch",
    name: "The Ashgate Watch",
    x: 238,
    z: -146,
    activity: "wondering",
    dwell: 45,
    waresTag: "heights",
    landmark: "watchtower",
    loreId: "the-ashgate-watch",
    lines: [
      "A tower, a fire ring, and a stack of wood somebody keeps dry. There is no one posted here. The wood is dry.",
      "From the top you can see the gap, the delve, and about forty miles of nothing. On a clear day that is worth the climb. On any other day it is not.",
      "There's a name scratched into every course of the stair. Same hand, forty years apart, getting worse.",
    ],
  },

  // --- The Kestrel March ---------------------------------------------------
  {
    id: "long-screes",
    name: "The Long Screes",
    x: 268,
    z: -196,
    activity: "travelling",
    dwell: 30,
    waresTag: "heights",
    loreId: "the-long-screes",
    lines: [
      "Half a mile of loose rock lying at the angle it wants to lie at, and every step you take goes back down a little. That is the whole experience.",
      "Cross it high or cross it low. Crossing it in the middle is how you learn which.",
      "Nothing lives here. Not 'not much'. Nothing.",
    ],
  },
  {
    id: "hawkstone-cairn",
    name: "The Hawkstone Cairn",
    x: 256,
    z: -276,
    activity: "discovering",
    dwell: 55,
    waresTag: "heights",
    loreId: "the-hawkstone-cairn",
    questId: "a-stone-for-the-cairn",
    lines: [
      "Chest high, and it grows. Everyone who gets up here adds one.",
      "No saint, no battle, nobody buried under it. Just proof that people came this far.",
      "Carry yours up from below the ridge, not off the scree. The carrying is the point.",
    ],
  },
  {
    id: "weather-cross",
    name: "The Weather Cross",
    x: 232,
    z: -306,
    activity: "wondering",
    dwell: 50,
    waresTag: "heights",
    loreId: "the-weather-cross",
    lines: [
      "Stone cross on the watershed, arms worn down to stumps. Rain falling this side goes to the mere. Rain falling that side goes east, and I have no idea where.",
      "Highest thing anybody ever carried up here, and they carried it to mark a line you cannot see and cannot cross wrongly.",
      "The wind takes your voice off sideways. The first time I sang up here I could not hear myself, and I have not tried again.",
    ],
  },
  {
    id: "anchorites-cell",
    name: "The Anchorite's Cell",
    x: 170,
    z: -286,
    activity: "discovering",
    dwell: 60,
    waresTag: "curio",
    loreId: "the-anchorites-cell",
    questId: "the-cup-on-the-ledge",
    lines: [
      "A cave with a wall built across the front of it and a slot in the wall the width of a bowl. That is a cell. Somebody had themselves shut in here.",
      "Forty years, they say. Food in through the slot — and the slot is worn smooth along the bottom edge, so somebody was passing something through it for a very long time.",
      "There is still a cup on the ledge inside. It is not an old cup.",
      "I don't go in. I sit out here in the light and say hello, which is either courtesy or cowardice and I have never settled it.",
    ],
  },
  {
    id: "kestrel-march",
    name: "The Kestrel March",
    x: 210,
    z: -232,
    activity: "wondering",
    dwell: 45,
    waresTag: "heights",
    loreId: "the-march-nobody-held",
    lines: [
      "A march is a border you keep soldiers on. There have never been soldiers up here.",
      "The birds will let you walk right up to them. Nothing has ever taught them not to.",
      "Thin air. Give me a moment before you ask me anything clever.",
    ],
  },

  // --- Greyneedle ----------------------------------------------------------
  {
    id: "crowtarn",
    name: "Crowtarn",
    x: 92,
    z: -170,
    activity: "performing",
    dwell: 90,
    songId: "until-it-leads-me-home",
    waresTag: "wood",
    loreId: "the-crows-of-crowtarn",
    questId: "the-crow-count",
    lines: [
      "Wait for dusk. They come in off the whole pine country and go round the water three times.",
      "Not twice. Not four. I've watched forty evenings of it and I still catch myself counting along.",
      "Then they drop into the trees all at once, and the wood goes quieter than it was before they came.",
    ],
  },
  {
    id: "deadfall",
    name: "The Deadfall",
    x: 10,
    z: -118,
    activity: "wondering",
    dwell: 50,
    waresTag: "wood",
    loreId: "the-night-the-wood-went-over",
    questId: "count-the-fallen",
    lines: [
      "Nine hundred trees down in one night, all lying the same way, as though something walked through here and did not stop.",
      "It was wind. It was a very great deal of wind, at the exact hour of the exact night the priory happened to be awake — which is the only reason we have the hour.",
      "You don't walk this. You climb it. Two hours to cross what used to take twenty minutes.",
      "The young stuff coming up through it is thicker than anything else in this wood. It'll be a better wood than the one it lost. Not in my time.",
    ],
  },
  {
    id: "greyneedle-wood",
    name: "Greyneedle",
    x: 38,
    z: -148,
    activity: "talking",
    dwell: 55,
    waresTag: "wood",
    loreId: "the-needle-path",
    lines: [
      "A hand's depth of needles over everything. You'll make no sound at all in here.",
      "That's pleasant for the first mile. In the second mile most people start humming.",
      "Three separate men have sworn to me they were followed through here. They were hearing themselves being alone.",
    ],
  },
  {
    id: "priory",
    name: "Greyneedle Priory",
    x: 66,
    z: -186,
    activity: "performing",
    dwell: 90,
    songId: "until-it-leads-me-home",
    waresTag: "priory",
    landmark: "chapel",
    loreId: "the-rule-and-the-bell",
    questId: "the-weather-book",
    lines: [
      "Nine brothers, one bell, and a rule of silence they keep about as well as nine men in a wood were ever going to.",
      "They'll feed anybody who knocks and they won't ask your name and they won't give you theirs. Eleven years I've come here. I know one.",
      "I'm allowed to play. Not to sing. That has never been explained to me and I have never pushed it, and the not-pushing is why I'm still allowed.",
      "They keep a book of the weather going back four hundred years. It is the most useful document in this valley and nobody outside these walls has read it.",
    ],
  },

  // --- Skarnfell -----------------------------------------------------------
  {
    id: "skarnfoot",
    name: "Skarnfoot",
    x: 2,
    z: -208,
    activity: "trading",
    dwell: 75,
    songId: "until-it-leads-me-home",
    waresTag: "heights",
    landmark: "forge",
    loreId: "last-roof-before-the-pass",
    lines: [
      "Last roof before the pass, and they'll tell you so before you have your cloak off.",
      "Everything here is priced for a man who has to decide, right now, whether he is going over. That is not gouging. It is standing very close to it.",
      "Eleven weeks a year this is the end of the road, and for eleven weeks a year it is the best-fed village in the valley.",
      "Nobody who lives here has been over the pass. Go on. Ask.",
    ],
  },
  {
    id: "snow-gate-cottage",
    name: "The Last Cottage",
    x: 14,
    z: -232,
    activity: "talking",
    dwell: 55,
    waresTag: "heights",
    landmark: "cottage",
    loreId: "the-woman-who-shuts-the-pass",
    lines: [
      "Last cottage below the pass, and the woman in it decides the day it shuts. No office, no appointment. Her mother did it. Her daughter won't.",
      "She walks up, she looks, she comes down. If she doesn't walk up the next morning, that is the answer, and the whole valley reads it off her door.",
      "She has been wrong once in thirty-one years. She shut it four days early. Nobody died. She has not forgiven herself, and I have watched her not forgive herself.",
      "There is tea. There is always tea. It is always too strong and I have never once said so.",
    ],
  },
  {
    id: "skarn-pass",
    name: "Skarn Pass",
    x: -8,
    z: -246,
    activity: "travelling",
    dwell: 30,
    waresTag: "heights",
    landmark: "watchtower",
    loreId: "the-snow-gate",
    questId: "carry-the-post",
    lines: [
      "The pass shuts eleven weeks a year, and one woman decides the day it shuts.",
      "No bell, no proclamation. She simply doesn't walk back up. Everyone knows what that means.",
      "First one through when it opens carries the post for nothing. There's never been a year without a volunteer.",
    ],
  },
  {
    id: "high-snows",
    name: "The High Snows",
    x: -58,
    z: -296,
    activity: "wondering",
    dwell: 50,
    waresTag: "heights",
    loreId: "where-the-sildwater-begins",
    lines: [
      "It comes out of a crack the size of your hand. I stopped it with my thumb once and felt like a thief.",
      "Sixty miles down it is turning three mills and drowning the occasional drover.",
      "There's a tin cup on a chain. Somebody replaces it when it wears through. That's the entire shrine.",
    ],
  },
  {
    id: "whinstone-fold",
    name: "Whinstone Fold",
    x: -72,
    z: -238,
    activity: "resting",
    dwell: 60,
    waresTag: "heights",
    loreId: "the-whinstone-fold",
    questId: "bring-them-down",
    lines: [
      "A ring of drystone with one gap in it, and the gap faces away from the weather. That is four hundred years of somebody paying attention.",
      "You gather the flock in here before the gate shuts. If you're late you winter up here with them, and men have.",
      "Not a scrap of mortar in any of it. It has stood through everything the fell has, because it lets the wind through instead of arguing with it. There's a lesson in that and I'm too tired to make it.",
    ],
  },
  {
    id: "sildwater-head",
    name: "The Sildwater Head",
    x: -43,
    z: -152,
    activity: "resting",
    dwell: 65,
    waresTag: "wood",
    loreId: "the-head-of-the-water",
    lines: [
      "Same water as the crossing down south. Forty miles younger and in a considerable hurry.",
      "You can hear it under the timbers. That's the whole valley leaving.",
      "I'll sit a while. The road will still be there.",
    ],
  },

  // --- The Hollowmoor ------------------------------------------------------
  {
    id: "thistlebeck-bridge",
    name: "The Thistlebeck",
    x: -122,
    z: -111,
    activity: "resting",
    dwell: 60,
    waresTag: "moor",
    landmark: "bridge",
    loreId: "the-thistlebeck-toll",
    lines: [
      "There was a toll here a hundred and forty years. Then the family died out and nobody could work out who to pay.",
      "People still leave a coin on the sill. Not out of fear — out of the instinct that makes you thank a door somebody held.",
      "A hundred and forty years is long enough to teach a road a habit.",
    ],
  },
  {
    id: "hollowmoor-stones",
    name: "The Nine",
    x: -140,
    z: -126,
    activity: "discovering",
    dwell: 70,
    waresTag: "curio",
    landmark: "standing_stones",
    loreId: "the-nine-at-hollowmoor",
    questId: "the-tenth-stone",
    lines: [
      "Nine of them, dragged eight miles from a bed out west. That's the only hard fact anybody has, and it's a monstrous one.",
      "They aren't aligned to the sunrise. People have checked, hopefully, for a hundred years.",
      "There's a gap on the north side wide enough for a tenth. Nobody digs it.",
      "The stones like this one. Don't ask me how I know.",
    ],
  },
  {
    id: "peat-cuttings",
    name: "The Peat Cuttings",
    x: -108,
    z: -160,
    activity: "trading",
    dwell: 70,
    waresTag: "moor",
    loreId: "the-turf-right",
    lines: [
      "Every house on the moor has a right to a strip, every strip is marked with a stick, and nobody has ever moved a stick.",
      "Cut in May, stood in June, carried in August, burnt from November. You can set a year by that more reliably than by any calendar I've been shown.",
      "The face is eight feet down now. Somewhere under your boots there is a wood, flattened and black, and it burns.",
    ],
  },
  {
    id: "hollowmoor-camp",
    name: "The Hollowmoor Camp",
    x: -142,
    z: -188,
    activity: "performing",
    dwell: 85,
    songId: "until-it-leads-me-home",
    waresTag: "moor",
    landmark: "camp",
    loreId: "the-fires-that-go-out",
    lines: [
      "Fires go out when anyone comes up the road, and they go back on after. I've never had to knock. They simply decide.",
      "Nobody here will tell you where they're from and everybody here will feed you. Work out what that costs them before you take it twice.",
      "I play here and I take nothing, and that has been the arrangement since the first year — when I did take something, and did not sleep well.",
      "It is not a lawless place. It has more rules than Wealdmoot. They are just not written anywhere you could read them.",
    ],
  },
  {
    id: "pipers-cairn",
    name: "The Piper's Cairn",
    x: -176,
    z: -196,
    activity: "wondering",
    dwell: 50,
    waresTag: "moor",
    loreId: "the-pipers-cairn",
    lines: [
      "A cairn on a moor with no view and no path to it. Somebody died on this exact spot, and somebody else knew exactly where.",
      "They call him the piper. Nobody can tell me what he played, or when, or whether he was ever anybody at all.",
      "It takes a stone from whoever passes, same as the Hawkstone. The difference is that up on the March you're proving you got there. Here you're apologising.",
    ],
  },
  {
    id: "the-bield",
    name: "The Bield",
    x: -248,
    z: -234,
    activity: "resting",
    dwell: 60,
    waresTag: "moor",
    loreId: "the-bield",
    lines: [
      "Four short walls in a cross, no roof, out where there is nothing else whatsoever. However it's blowing, one arm of it is out of the wind.",
      "Built for sheep. Used by sheep. Used by me, twice, and I would not have got down off this fell either time without it.",
      "This is the furthest thing from a house I have ever been grateful to.",
    ],
  },

  // --- The long way home: the west moor, the Tarnwild, and back to the Green
  {
    id: "last-tree",
    name: "The Last Tree",
    x: -296,
    z: -138,
    activity: "wondering",
    dwell: 45,
    waresTag: "wood",
    loreId: "the-last-tree",
    lines: [
      "One pine, bent double downwind, and past it there is not another as far as anybody has bothered to walk.",
      "It isn't the edge of the wood. It's the edge of trees. There is a difference and you can feel it standing here.",
      "Somebody's tied a strip of cloth to it. Somebody has been doing that a long time, judging by the knots underneath.",
    ],
  },
  {
    id: "sweetwell",
    name: "Sweetwell",
    x: -190,
    z: -116,
    activity: "resting",
    dwell: 60,
    waresTag: "moor",
    landmark: "shrine",
    loreId: "the-spring-that-moved",
    questId: "where-the-water-went",
    lines: [
      "A spring on open heath, coming up cold out of nothing, in the middle of a moor that is sour for four miles in every direction.",
      "It tastes of iron and it stains the stones orange and there is not a person on this moor who will drink from anywhere else.",
      "It stopped once. Six weeks, in a summer nobody wanted. Then it came back forty paces to the left and everyone agreed never to mention it.",
      "Fill the flask. Go on. You'll not get water like this again before the pass.",
    ],
  },
  {
    id: "leaning-shrines",
    name: "The Leaning Shrines",
    x: -206,
    z: -56,
    activity: "discovering",
    dwell: 55,
    waresTag: "curio",
    landmark: "shrine",
    loreId: "the-leaning-shrines",
    lines: [
      "Two shrines and a broken wall, and all three of them leaning the same way, which is the way the wind comes.",
      "Nobody keeps these. There is no village within a day's walk. And there are fresh things on the ledges, so somebody comes.",
      "I leave a copper. I could not tell you to whom, or for what. I have stopped being embarrassed about it, which took longer than the walk out here.",
    ],
  },
  {
    id: "tarnwild-edge",
    name: "The Tarnwild",
    x: -238,
    z: -40,
    activity: "wondering",
    dwell: 50,
    waresTag: "wood",
    loreId: "black-water-tarnwild",
    lines: [
      "The tarns look like ink and they're perfectly clear. Peat under, no weed in, nothing for the light to come back off.",
      "Which does not help at all when you're standing over one.",
      "West of anywhere a sensible person has business being, they say. They're right. I keep coming.",
    ],
  },
  {
    id: "wolfpine-camp",
    name: "Wolfpine Camp",
    x: -272,
    z: -6,
    activity: "resting",
    dwell: 95,
    songId: "until-it-leads-me-home",
    waresTag: "wood",
    landmark: "camp",
    loreId: "somebodys-fire",
    questId: "dry-wood-for-wolfpine",
    lines: [
      "The ring's never quite cold. That isn't a ghost. That's a hundred and fifty miles of empty with one decent spot in it.",
      "I've come in here shaking and found dry kindling under a stone, left by somebody I'll never meet, for somebody they'd never meet.",
      "Whoever built this fire left in a hurry.",
      "If you want to know what holds a country together, it isn't the roads.",
    ],
  },
  {
    id: "duskpool",
    name: "Duskpool",
    x: -66,
    z: 6,
    activity: "performing",
    dwell: 85,
    songId: "until-it-leads-me-home",
    loreId: "the-lantern-at-duskpool",
    questId: "who-hangs-the-lantern",
    lines: [
      "Lantern's lit. Somebody's been down here before us and gone.",
      "Black water takes a voice and gives you back about half of it. Suits this one.",
      "I'll play the lantern song here or I won't play it at all.",
      "It's clean enough to drink. It just tastes like a cellar.",
    ],
  },
];

// ---------------------------------------------------------------------------
// Settlement and region binding
// ---------------------------------------------------------------------------

/**
 * The settlement a destination belongs to, if any.
 *
 * Resolved from `SETTLEMENTS` at module load rather than hand-written into the
 * table above, because the settlement ids are owned by `world/settlements.ts`
 * and a hand-copied id is a broken link waiting for someone to rename a
 * village. Distance is measured in the settlement's own radii so a large town
 * claims further out than a camp; anything past 1.15 radii belongs to nobody,
 * which is correct for the cairn, the milestone and the fen.
 */
function settlementNear(x: number, z: number): string | undefined {
  let best: string | undefined;
  let bestScore = 1.15;
  for (const settlement of SETTLEMENTS) {
    const dx = x - settlement.x;
    const dz = z - settlement.z;
    const score = Math.sqrt(dx * dx + dz * dz) / Math.max(1, settlement.radius);
    if (score < bestScore) {
      bestScore = score;
      best = settlement.id;
    }
  }
  return best;
}

export const DESTINATIONS: Destination[] = TOUR.map((destination) => ({
  ...destination,
  settlementId: destination.settlementId ?? settlementNear(destination.x, destination.z),
  // Same argument as the settlement: `regions.ts` owns the map, and a
  // hand-written region id is a lie waiting for somebody to move a border.
  regionId: destination.regionId ?? regionAt(destination.x, destination.z).id,
}));

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function destinationById(id: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.id === id);
}

export function destinationsIn(settlementId: string): Destination[] {
  return DESTINATIONS.filter((d) => d.settlementId === settlementId);
}

export function destinationsInRegion(regionId: string): Destination[] {
  return DESTINATIONS.filter((d) => d.regionId === regionId);
}

/**
 * How many stops each region has.
 *
 * Not decoration: the whole point of this table is that no part of the map is
 * empty, and this is the assertion a test or a dev overlay checks it with.
 * Every region in `REGIONS` gets a key, including any that scores zero.
 */
export function destinationCountByRegion(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const region of REGIONS) counts[region.id] = 0;
  for (const destination of DESTINATIONS) {
    const id = destination.regionId;
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/** The next leg of the round. Wraps — the tour has no end. */
export function nextDestination(id: string): Destination {
  const index = DESTINATIONS.findIndex((d) => d.id === id);
  if (index < 0) return DESTINATIONS[0];
  return DESTINATIONS[(index + 1) % DESTINATIONS.length];
}

export function nearestDestination(x: number, z: number): Destination {
  let best = DESTINATIONS[0];
  let bestDistance = Infinity;
  for (const destination of DESTINATIONS) {
    const dx = x - destination.x;
    const dz = z - destination.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = destination;
    }
  }
  return best;
}

/**
 * The thing he is standing next to, if anything was built here.
 *
 * Derived rather than authored. `settlements.ts` rejection-samples every
 * structure against the road, the water and its neighbours, so the exact
 * position of the windmill at Longmead is not knowable from this file and will
 * move if anybody touches the placer. What *is* stable is that a windmill is
 * placed in that cluster — so a destination names the kind it came for and
 * this finds the nearest one, and the link survives.
 *
 * Give this to a camera that wants something to look at, or to an interaction
 * prompt that wants somewhere to hang itself.
 */
export function landmarkAt(
  destination: Destination,
  within = 34
): Structure | undefined {
  let best: Structure | undefined;
  let bestDistance = within * within;
  for (const structure of STRUCTURES) {
    if (destination.landmark && structure.kind !== destination.landmark) continue;
    const dx = structure.x - destination.x;
    const dz = structure.z - destination.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = structure;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Deterministic line selection
// ---------------------------------------------------------------------------

/**
 * Integer hash -> [0, 1). Lifted from `world/terrain.ts` unchanged.
 *
 * `Math.imul` is load-bearing. A plain `*` on these constants runs past 2^53
 * and the float quietly drops its low bits — which are the whole output of a
 * hash. Written with `*` this returns a mean of 0.25 with a third of the
 * spread, and every caller downstream inherits the bias.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** FNV-1a, so an id string can seed the same integer hash. */
function hashString(text: string): number {
  let h = 2166136261 | 0;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h | 0;
}

/**
 * Which line he says on the `visit`-th arrival at a place.
 *
 * Deterministic on purpose: two players watching the same bard in the same
 * session must hear the same sentence, and a replay of a session must produce
 * the session. Cycling the array in order would be the obvious alternative and
 * sounds like a machine; hashing lets him repeat himself occasionally, which is
 * what people actually do.
 */
export function arrivalLine(destination: Destination, visit: number): string {
  if (!destination.lines.length) return "";
  const roll = hash2(hashString(destination.id), visit);
  return destination.lines[Math.floor(roll * destination.lines.length) % destination.lines.length];
}

// ---------------------------------------------------------------------------
// Itinerary
// ---------------------------------------------------------------------------

/**
 * Metres per second, matched to the half-speed walk clip so his feet do not
 * slide. It is a genuine amble — he is not going anywhere, that is the point —
 * and the whole round takes a few hours of world time. Pass your own to the
 * functions below if your game runs on a compressed clock.
 */
export const TRAVEL_SPEED = 0.39;

/** Straight-line leg lengths, precomputed once. Index i = i -> i+1. */
const LEG_METRES: number[] = DESTINATIONS.map((destination, i) => {
  const next = DESTINATIONS[(i + 1) % DESTINATIONS.length];
  const dx = next.x - destination.x;
  const dz = next.z - destination.z;
  return Math.sqrt(dx * dx + dz * dz);
});

/** Total walked distance of one full round, in metres. */
export const TOUR_LENGTH_METRES = LEG_METRES.reduce((sum, m) => sum + m, 0);

/** Total time he spends standing still on one full round, in seconds. */
export const TOTAL_DWELL_SECONDS = DESTINATIONS.reduce((sum, d) => sum + d.dwell, 0);

/** Seconds for one full round at a given pace. */
export function tourSeconds(speed: number = TRAVEL_SPEED): number {
  return TOTAL_DWELL_SECONDS + TOUR_LENGTH_METRES / Math.max(0.01, speed);
}

export type ItineraryFix = {
  destination: Destination;
  next: Destination;
  phase: "dwelling" | "travelling";
  /** 0..1 through the current phase. */
  progress: number;
  /** Straight-line estimate. See the note below. */
  x: number;
  z: number;
};

/**
 * Where he is, `seconds` into the round.
 *
 * The position is a straight line between destinations, which is an honest
 * approximation for an out-of-world consumer (a companion app asking "where is
 * he right now") and a lie in the scene, where he follows the road network and
 * walks round hills. In-world, drive him from the destination sequence and let
 * the mover path him; use this for the API and for anything that needs an
 * answer without a running simulation.
 */
export function itineraryAt(
  seconds: number,
  speed: number = TRAVEL_SPEED
): ItineraryFix {
  const pace = Math.max(0.01, speed);
  const cycle = tourSeconds(pace);
  const safe = Number.isFinite(seconds) ? seconds : 0;
  let t = safe % cycle;
  if (t < 0) t += cycle;

  for (let i = 0; i < DESTINATIONS.length; i++) {
    const destination = DESTINATIONS[i];
    const next = DESTINATIONS[(i + 1) % DESTINATIONS.length];

    if (t < destination.dwell) {
      return {
        destination,
        next,
        phase: "dwelling",
        progress: destination.dwell > 0 ? t / destination.dwell : 1,
        x: destination.x,
        z: destination.z,
      };
    }
    t -= destination.dwell;

    const walk = LEG_METRES[i] / pace;
    if (t < walk) {
      const k = walk > 0 ? t / walk : 1;
      return {
        destination,
        next,
        phase: "travelling",
        progress: k,
        x: destination.x + (next.x - destination.x) * k,
        z: destination.z + (next.z - destination.z) * k,
      };
    }
    t -= walk;
  }

  // Floating-point crumbs at the very end of the cycle.
  const last = DESTINATIONS[DESTINATIONS.length - 1];
  return {
    destination: last,
    next: DESTINATIONS[0],
    phase: "travelling",
    progress: 1,
    x: last.x,
    z: last.z,
  };
}
