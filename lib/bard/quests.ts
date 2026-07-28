/**
 * The errands Punaab hands out, and what he thinks they are worth.
 *
 * He is a bard, not a quest board. He does not have tasks; he has things that
 * have been bothering him, and after a while of walking with you he will start
 * saying them out loud. So a quest here is written the way he would put it —
 * the ask first, the reason second, and the reason is usually a person.
 *
 * `giverId` is a `Destination` id: the place he offers it. `steps` is present
 * where the errand genuinely has stages and absent where it does not, because
 * a one-line favour dressed up as a three-stage objective chain is how a world
 * stops sounding like a place and starts sounding like a spreadsheet.
 *
 * `reward` is a *suggestion*. This module has no idea what your economy looks
 * like, so it hands you a coin figure in the same coppers `wares.ts` prices in,
 * an optional item or song or lore unlock, and a sentence describing what he
 * actually says he will give you — which is often better than the coin.
 *
 * -------------------------------------------------------------------------
 * FOR GAME DEVELOPERS: replacing this
 * -------------------------------------------------------------------------
 * Rows in your project's `quests` table are laid over these by
 * `resolveQuests()` and served from `GET /api/v1/quests`.
 *
 *   1. REPLACE ONE QUEST — match a default's `title` (loosely: punctuation and
 *      case are ignored). Your body wins; the giver, steps and reward are kept
 *      unless you declare your own.
 *
 *   2. ADD A NEW QUEST — any unmatched title is appended. Declare the parts the
 *      `quests` table has no columns for with directive lines at the top of the
 *      body:
 *
 *          giver: fen-causeway
 *          region: thornwake
 *          coin: 45
 *          item: fen-lamp-oil
 *          song: until-it-leads-me-home
 *          lore: the-causeway-markers
 *          reward: Forty-five coppers and the loan of a lamp.
 *          steps: Light the first post | Walk the line | Light the last
 *
 *          Somebody has to walk the causeway before dark ...
 *
 *      Every directive is optional and `steps` is a `|`-separated list. The
 *      block only opens if the very first line is a recognised key or a `---`
 *      fence, so a body that opens "Note: ..." is stored exactly as written.
 *      Unknown keys inside an open block are ignored, so you can keep your own
 *      bookkeeping in there.
 *
 *   3. THROW THE LOT AWAY — `resolveQuests(rows, { mode: "replace" })` serves
 *      only your rows.
 */

import { parseDirectives, slug, splitList } from "./wares";
import type { Origin, ResolveOptions } from "./wares";

export type QuestStep = {
  id: string;
  text: string;
  /** `Destination.id` this step happens at, when it happens somewhere. */
  locationId?: string;
};

export type QuestReward = {
  /** In the same coppers `wares.ts` prices in. A suggestion, not a rule. */
  coin?: number;
  /** `Ware.id` he hands over. */
  itemId?: string;
  /** `Song.id` from `songs.ts` — he will play it for you and mean it. */
  songId?: string;
  /** `LoreEntry.id` unlocked on completion. */
  loreId?: string;
  /** What he says you will get. Show this, not the numbers. */
  note: string;
};

export type Quest = {
  id: string;
  title: string;
  body: string;
  /** The `Destination.id` where he offers it. */
  giverId: string;
  regionId?: string;
  steps?: QuestStep[];
  reward: QuestReward;
  repeatable?: boolean;
  origin?: Origin;
  /** `quests.id` of the row this came from, when it came from a project. */
  rowId?: string;
};

const step = (id: string, text: string, locationId?: string): QuestStep => ({
  id,
  text,
  locationId,
});

/**
 * Thirty-two errands spread across the valley, roughly in the order he walks
 * past them.
 *
 * Most are multi-step and several of those cross the map, because a bard who
 * wanders 640 metres in every direction should occasionally be the reason you
 * do too. Three of them pay nothing, one of them ends in nothing at all, and
 * he does not know that last one when he asks — which is the point of it.
 *
 * The test every entry here has to pass: somebody is inconvenienced if it does
 * not get done, and that somebody is a person rather than a world state. A
 * hamlet that will move on the evidence of a stick in the mud. A ninety-year-old
 * with a rope in the wrong building. Nine hives that have not been told.
 */
export const DEFAULT_QUESTS: Quest[] = [
  {
    id: "what-the-scales-say",
    title: "What the Scales Say",
    giverId: "wealdmoot-market",
    regionId: "wanderers-green",
    body: "There is a stall on the north side whose scales run three-quarters of an ounce light, and have done for two years, and everybody who buys there knows it, and everybody who buys there keeps buying — because he is the only man in the square who will sell on credit to a house with nothing in it. I am not asking you to have him fined. I am asking you to find out what he is owed, and by whom, and whether it comes to more than he has taken. Then tell me, and I will work out whether I have a song or a silence.",
    steps: [
      step("weigh", "Buy a pound of something and weigh it on the moot scales.", "wealdmoot-market"),
      step("tally", "Read his tally sticks. He keeps them openly, which should tell you something.", "wealdmoot-market"),
      step("sum", "Add both columns and take the answer to the bench, not to the magistrate.", "moot-bench"),
    ],
    reward: {
      coin: 30,
      itemId: "tally-stick",
      loreId: "the-market-peace",
      note: "Thirty coppers and a split tally stick, and no song about it in the square for as long as you both live.",
    },
  },
  {
    id: "walking-the-bounds",
    title: "Walking the Bounds",
    giverId: "three-parish-stone",
    regionId: "wanderers-green",
    body: "They beat the bounds at Rogation, and this year Barleyhearth is a man short, because the man who walked the north leg for thirty years died in February and nobody has yet said out loud that someone has to do it. It is a day's walk, it is wet, and there is a boy at each corner whose head has to be bumped on a stone and who has to be told what he is now responsible for. Walk the north leg. Say the names at every mark. That is all it is, and it is not nothing.",
    steps: [
      step("list", "Take the list of marks off the Barleyhearth clerk. Do not let him shorten it.", "barleyhearth"),
      step("walk", "Walk the north leg, mark by mark, and say each name where it stands.", "liars-acre-hedge"),
      step("boy", "Bump the boy's head on the three-parish stone and tell him the names back.", "three-parish-stone"),
    ],
    reward: {
      coin: 24,
      itemId: "mostly-right-map",
      loreId: "the-three-parish-stone",
      note: "Twenty-four coppers out of parish funds, and his own map, because after a day of that you will have earned the right to correct it.",
    },
  },
  {
    id: "who-hangs-the-lantern",
    title: "Who Hangs the Lantern",
    giverId: "duskpool",
    regionId: "wanderers-green",
    body: "Somebody puts a lit lantern on that alder most nights and the whole Green has agreed to pretend it hangs itself. I have asked politely for four years. I would like to buy whoever it is a drink before I am too old to walk out here, and I would like it very much if you did not tell them I sent you.",
    steps: [
      step("wait", "Sit at the pool until full dark and see who comes.", "duskpool"),
      step("follow", "Follow the path they take back toward the fields.", "wanderers-cross"),
      step("ask", "Ask in Barleyhearth whose lamp oil goes missing.", "barleyhearth"),
    ],
    reward: {
      coin: 20,
      loreId: "the-lantern-at-duskpool",
      songId: "until-it-leads-me-home",
      note: "Twenty coppers, and he will play the lantern song properly — sitting down, no coin cup out.",
    },
  },
  {
    id: "liars-acre",
    title: "Liar's Acre",
    giverId: "barleyhearth",
    regionId: "barleyhearth",
    body: "Two houses here have been calling each other thieves for sixty years over one boundary stone, and both of them feed me, so I cannot take a side. But the old stone was not destroyed — a thing that size never is. It was moved, and it was moved by somebody in a hurry at night, which means it did not go far.",
    steps: [
      step("pace", "Pace the hedge line from the parish mark and find where it bends wrong.", "barleyhearth"),
      step("dig", "Look under the hedge bank on the low side. Downhill, always.", "barleyhearth"),
      step("tell", "Tell both households at once, in the same room, out loud.", "barleyhearth"),
    ],
    reward: {
      coin: 35,
      itemId: "seed-corn",
      loreId: "the-naming-of-fields",
      note: "Thirty-five coppers from the parish, a pint of seed corn, and two families who will never quite forgive you.",
    },
  },
  {
    id: "who-lived-at-ashcroft",
    title: "Who Lived at Ashcroft",
    giverId: "ashcroft",
    regionId: "barleyhearth",
    body: "Somebody filled that well in with stone after the fire, on purpose, and nobody in six villages will tell me who lived here. I have run out of ways to ask it that do not make people go quiet. You are not me, and nobody owes you a kindness they are busy protecting. There is a parish book at Barleyhearth. Find the name in it — and if the page has been taken out, and I have come to think it has, then find out who was clerk that year.",
    steps: [
      step("book", "Read the parish book at Barleyhearth for the year of the fire.", "barleyhearth"),
      step("clerk", "If the page is gone, find out who held the pen. Somebody's grandmother knows.", "hearthwick"),
      step("say", "Come back and say the name out loud in the yard, once, with him standing there.", "ashcroft"),
    ],
    reward: {
      coin: 45,
      itemId: "burnt-beam",
      loreId: "the-burning-of-ashcroft",
      note: "Forty-five coppers, a hand's width of the burnt roof beam, and no song about it — which you should take as the point rather than as a slight.",
    },
  },
  {
    id: "long-lane",
    title: "Long Lane",
    giverId: "mirrormere-shore",
    regionId: "saltmere",
    body: "The mere is low this year. Low enough to walk the old road out into it, which happens perhaps twice in a life. There will be a milestone down there — every lane in this valley had them — and I want to know what it says. Not for a song. I just want to know where that road was going before the water got the argument.",
    steps: [
      step("walk", "Walk the drowned lane out from the north shallows while the water is low.", "mirrormere-shore"),
      step("read", "Find the milestone and clear the weed off the face of it.", "mirrormere-shore"),
      step("carry", "Carry the reading back before the wind gets up.", "mirrormere-shore"),
    ],
    reward: {
      coin: 30,
      itemId: "blunted-glass",
      loreId: "the-drowned-lane",
      note: "Thirty coppers, a bit of green glass he has been carrying for luck, and a verse with your name in it if the stone says anything worth singing.",
    },
  },
  {
    id: "the-salt-count",
    title: "The Salt Count",
    giverId: "saltmere-strand",
    regionId: "saltmere",
    body: "Fresh water, salt on the rocks, and four hundred years of shrugging. Here is what nobody has done: measured it. Scrape the west rocks the morning after a blow and weigh what you get, three blows running, and we will at least know whether it is the wind bringing it or the water making it. It is not a heroic errand. Most true things are not.",
    steps: [
      step("first", "Scrape and weigh after the first west wind.", "saltmere-strand"),
      step("second", "Do it again after the second, and note which way the wind sat.", "low-strand"),
      step("third", "Third time. Then take the numbers to somebody who can read them.", "saltmere-strand"),
    ],
    reward: {
      coin: 18,
      itemId: "mere-salt",
      loreId: "the-salt-on-the-west-wind",
      note: "Eighteen coppers of his own money and as much salt as you can carry, because he genuinely wants to know.",
    },
  },
  {
    id: "the-gable-count",
    title: "The Gable Count",
    giverId: "underlyme",
    regionId: "saltmere",
    body: "The water is low enough this year to count the gables, and there is a list in the chest at Saltmere Quay of every household that came out of Underlyme while it was drowning. If the two numbers agree then everybody got out, and I can stop turning it over. If the gables come to more than the households — and I have counted twice, and I would very much like to be wrong about this — then somebody stayed.",
    steps: [
      step("count", "Count the gables from the shingle while the water holds low. Twice, and from two places.", "underlyme"),
      step("list", "Get the household list out of the chest at the quay. They will want a reason. Give them one.", "mere-lamp"),
      step("compare", "Bring both numbers back and let him do the subtraction himself.", "underlyme"),
    ],
    reward: {
      coin: 35,
      itemId: "wreck-nail",
      songId: "until-it-leads-me-home",
      loreId: "underlyme",
      note: "Thirty-five coppers, a nail out of the old wreck, and the river song played properly on the shingle, whichever way the numbers go.",
    },
  },
  {
    id: "whose-boat",
    title: "Whose Boat",
    giverId: "mere-lamp",
    regionId: "saltmere",
    body: "Nineteen years of oil for a boat that is not coming, and the parish pays it without a word, and in all that time I have never once heard the boat named. I don't want a tragedy out of it. I want the name, so that when I sing the lantern song on this quay I am singing about a person and not about a lamp. Ask at the quay. Ask it badly if you have to — they will correct you, and a correction is an answer.",
    steps: [
      step("ask", "Ask at the quay and get it wrong on purpose. Then listen.", "mere-lamp"),
      step("register", "The register of boats is kept at the strand. Find the year the entries stop.", "saltmere-strand"),
      step("leave", "Do not ask the woman who lights it. That is the whole condition.", "mere-lamp"),
    ],
    reward: {
      coin: 26,
      itemId: "cork-float",
      songId: "until-it-leads-me-home",
      loreId: "the-lamp-that-is-still-lit",
      note: "Twenty-six coppers, a painted net float, and the lantern song sung with a name in it for the first time in nineteen years.",
    },
  },
  {
    id: "a-name-for-the-bees",
    title: "A Name for the Bees",
    giverId: "bee-garth",
    regionId: "cidergarth",
    body: "There is a black ribbon on the end skep and the bees have not been told, because the man who died left no household to tell them and the garth is arguing about whether a neighbour is allowed to do it. They will still be arguing in a fortnight and the bees will have gone. Get his name off the sexton, come back, knock on every hive in order and say it. Forty skeps. Out loud. You will feel like a fool for the first six and then you will not.",
    steps: [
      step("name", "Get the name off the sexton at Cidergarth. The full one, not the one they used.", "cidergarth"),
      step("tell", "Knock on each hive, in order, and tell them. Do not skip the empty ones.", "bee-garth"),
      step("ribbon", "Take the ribbon off the end skep when you reach it, and not before.", "bee-garth"),
    ],
    reward: {
      coin: 20,
      itemId: "garth-honey",
      loreId: "telling-the-bees",
      note: "Twenty coppers the garth will insist on, a jar of the light honey, and forty hives that have been told.",
    },
  },
  {
    id: "a-cutting-for-the-hollow",
    title: "A Cutting for the Hollow",
    giverId: "cidergarth",
    regionId: "cidergarth",
    body: "The orchard in Bracken Hollow is dying of nothing in particular — old wood, tired ground, no one under fifty left to prune it. The garth will give a cutting off the mother tree to anyone who will walk it there and get it in the ground before it wakes up. That is a long walk east with a stick of wet moss in your shirt, and it is the single most useful thing anyone in this valley will ask of you this year.",
    steps: [
      step("take", "Take the wrapped cutting from the shrine keeper at Cidergarth.", "mother-of-apples"),
      step("carry", "Get it east before the buds break. Keep the moss damp.", "elderloom-hall"),
      step("graft", "Graft and wax it into the best rootstock still standing in the Hollow.", "hollow-orchard"),
    ],
    reward: {
      coin: 40,
      itemId: "grafting-wax",
      loreId: "the-mother-of-apples",
      note: "Forty coppers from the garth, and a standing claim on a cup of the black cider every year the tree bears.",
    },
  },
  {
    id: "the-eleventh-willow",
    title: "The Eleventh Willow",
    giverId: "willowpond",
    regionId: "elderloom",
    body: "The count at Candlemas will be ten. One went over in the autumn gales and nobody has said so out loud yet, because saying it makes it a thing that has to be dealt with, and it is easier to let the boy miscount. A willow will root from a stick pushed in wet ground. That is all this needs. That, and it wants doing before the parish walks down here in the frost.",
    steps: [
      step("cut", "Cut three setts from the fallen tree while the sap is still down.", "willowpond"),
      step("plant", "Push them in on the north side where the ground stays wet.", "willowpond"),
    ],
    reward: {
      coin: 12,
      loreId: "the-willow-count",
      note: "Twelve coppers, a hot drink, and eleven willows at Candlemas.",
    },
    repeatable: true,
  },
  {
    id: "measure-the-ring",
    title: "Measure the Ring",
    giverId: "fairy-ring",
    regionId: "elderloom",
    body: "The ring in Ganger's Meadow walks north, and I have been pacing it out every spring for nineteen years with my own feet, which are not a unit that anybody can check after I am dead. Measure it properly — a cord, a peg, and the same two oaks to sight off every time — and write it down somewhere that is not me. In sixty years that is either a curiosity or it is the only record anybody has of how fast the thing walks.",
    steps: [
      step("peg", "Peg the north edge, sighted off the two oaks. Use those two and no others, ever.", "fairy-ring"),
      step("cord", "Measure across with a cord. Twice, at right angles, and write down both.", "fairy-ring"),
      step("lodge", "Leave the record with the priory, not with him. He is not going to outlast the ring.", "priory"),
    ],
    reward: {
      coin: 22,
      itemId: "oak-gall-ink",
      loreId: "the-ring-in-gangers-meadow",
      note: "Twenty-two coppers and a pot of oak gall ink, which is the ink everything ever written about this valley was written in.",
    },
  },
  {
    id: "what-the-wood-said",
    title: "What the Wood Said",
    giverId: "elderloom-hall",
    regionId: "elderloom",
    body: "I want three shouts made in Elderloom and I want them written down exactly as they come back. Not as you think they came back. I have been told what the wood says by eleven people and got eleven different sentences, and either the trees are inventing or we are, and I have got to the age where I would like to know which.",
    steps: [
      step("first", "Shout once at the road bend and write down the answer.", "elderloom-hall"),
      step("second", "Again, deeper in, where the canopy closes over.", "elderloom-hall"),
      step("third", "Once more at dusk. Then read all three back to him without looking at his face.", "elderloom-hall"),
    ],
    reward: {
      coin: 25,
      itemId: "elder-whistle",
      loreId: "the-wood-that-answers",
      note: "Twenty-five coppers and an elder whistle, so that next time you can be found.",
    },
  },
  {
    id: "forty-one-posts",
    title: "Forty-One Posts",
    giverId: "fen-causeway",
    regionId: "thornwake",
    body: "The house at the east end is down to one old man and he has not been able to walk the line since the summer, so half the causeway has gone dark and nobody has admitted it. There are forty-one posts. They want lighting from dusk, in order, and the order matters, because a man out on the fen steers by the gap between two lights and a wrong gap will kill him politely.",
    steps: [
      step("oil", "Take a flask of fen oil from the west house.", "fenmere-edge"),
      step("walk", "Light the line east to west. In order. Do not skip a dark one.", "fen-causeway"),
      step("count", "Count them off at the far end. If you have forty, go back.", "fen-causeway"),
    ],
    reward: {
      coin: 45,
      itemId: "fen-lamp-oil",
      loreId: "the-causeway-markers",
      note: "Forty-five coppers out of a jar the old man keeps by the door, and he will not hear of you refusing it.",
    },
  },
  {
    id: "sounding-the-ground",
    title: "Sounding the Ground",
    giverId: "fenreed",
    regionId: "thornwake",
    body: "Two of them walk the hamlet boundary with a sounding pole every spring, and this year there is one, because the other has a hand that will not close. It is a whole day of pushing a stick into mud and calling out where it goes in easy, and the hamlet decides whether to move on the strength of it, and I am too heavy and too old to be out on that ground with a pole. Go with him. Do the pushing. Let him do the writing — it is his hand and his hamlet.",
    steps: [
      step("pole", "Take the pole from the west house. Take the short one; the long one flatters the mud.", "fenreed"),
      step("sound", "Walk the whole boundary and call every depth out loud, in order, so he can write it.", "fenreed"),
      step("carry", "Get the marks back to the hamlet before the light goes. Not after.", "sedge-cut"),
    ],
    reward: {
      coin: 38,
      itemId: "punt-ferrule",
      loreId: "the-firm-ground",
      note: "Thirty-eight coppers, an iron ferrule off a broken punt pole, and a hamlet that knows for another year.",
    },
  },
  {
    id: "ring-it-anyway",
    title: "Ring It Anyway",
    giverId: "fen-bell",
    regionId: "thornwake",
    body: "The rope for that bell lives in the house so that children cannot play with it, and the man who keeps the house is ninety and cannot cross the yard fast. Fog comes off that fen in a quarter of an hour. Build a box on the post and hang the rope in it, and then teach two children in Fenreed how it is rung — not the story, the rhythm. The rhythm is how a man out on the fen knows which way in he is being called.",
    steps: [
      step("box", "Build a box on the post with a lid that a wet hand can open.", "fen-bell"),
      step("teach", "Teach the rhythm to two children who will still be here in fifty years.", "fenreed"),
      step("ring", "Ring it once, in clear weather, so that everyone hears it done properly.", "fen-bell"),
    ],
    reward: {
      coin: 30,
      itemId: "bog-myrtle",
      loreId: "the-fen-bell",
      note: "Thirty coppers, a sprig of bog myrtle for the flies, and an old man who will sleep through a fog for the first time in years.",
    },
  },
  {
    id: "the-name-of-the-watch",
    title: "The Name of the Watch",
    giverId: "ashen-hold",
    regionId: "ashenreach",
    body: "Somebody stood on that wall for years and barred that door at the end and nobody alive knows what to call them. I do not need the whole history. I need one name, and then I can write something that gets sung, and a name that gets sung does not finish going. There will be masons' marks at the quarry that match the Hold's stone, and there was a toll house on the moor road that kept a book for a hundred and forty years.",
    steps: [
      step("marks", "Match the masons' marks at the red quarry to the Hold's dressed stone.", "red-quarry"),
      step("book", "Find whatever is left of the toll house book at the Thistlebeck.", "thistlebeck-bridge"),
      step("stair", "If the book gives a name, take it back down the stair under the yard and say it out loud.", "ashen-hold"),
    ],
    reward: {
      coin: 60,
      itemId: "hold-coin",
      loreId: "the-ashen-hold",
      songId: "until-it-leads-me-home",
      note: "Sixty coppers — most of what he has — an old coin of the Hold, and a song that will outlast the pair of you.",
    },
  },
  {
    id: "the-quarry-lamp",
    title: "The Quarry Lamp",
    giverId: "red-quarry",
    regionId: "ashenreach",
    body: "The lower workings flooded in a wet spring and the men got out, all of them, which is a thing worth being clear about. But somebody left a lamp burning on the ledge to see the last of them up, and it has been under the red water since. The masons will not go in after it and they will not let it be forgotten either. Fetch it up and they will hang it in the shed, and that is the whole point of it.",
    steps: [
      step("rope", "Beg forty feet of sedge rope off the fen road.", "fenmere-edge"),
      step("dive", "Go down the flooded ledge in the lower workings.", "red-quarry"),
    ],
    reward: {
      coin: 28,
      itemId: "ashenreach-whetstone",
      loreId: "why-the-stone-runs-red",
      note: "Twenty-eight coppers, a whetstone off the good grit, and your name said out loud in the shed every year they light it.",
    },
  },
  {
    id: "the-ore-road",
    title: "The Ore Road",
    giverId: "the-delve",
    regionId: "ashenreach",
    body: "They have good ore they cannot weld, and there is a smith at Wealdmoot who has broken four hammers being certain of it, and the two of them have been shouting at each other across forty miles for three years without once standing in the same room. Carry a lump of it to that forge and stand there while he works it. Then carry back exactly what he says, including the parts you would rather soften, because the softened version is what has been going back and forth for three years.",
    steps: [
      step("take", "Take a lump from the third gallery, not off the heap. The heap is all weathered.", "the-delve"),
      step("forge", "Get it to the forge at Wealdmoot and stay to watch it worked.", "wealdmoot-market"),
      step("word", "Carry the smith's answer back to the delve, word for word, unsoftened.", "the-delve"),
    ],
    reward: {
      coin: 48,
      itemId: "delve-ore",
      loreId: "what-the-delve-owes",
      note: "Forty-eight coppers, a lump of the bad ore to carry as a curiosity, and either the end of an argument or a much better one.",
    },
  },
  {
    id: "whose-battle",
    title: "Whose Battle",
    giverId: "hallowfield",
    regionId: "sunder-flats",
    body: "A flat field, a ditch that is not a field ditch, and a name that means the dead in a language nobody here speaks. No barrow, no stone, no year. But the priory's book goes back four hundred years and the toll house at the Thistlebeck kept another hundred and forty, and somewhere in one of them is a season with too many burials in it. I don't need a victor. I need a date. Put a date in a song and it stops being a story about nobody.",
    steps: [
      step("pace", "Walk the ditch end to end and pace it. Note where it turns and where it stops.", "hallowfield"),
      step("book", "The priory's weather book, for a year with a great many burials written beside the weather.", "priory"),
      step("toll", "The toll book at the Thistlebeck, for the same year. Two sources or it is a rumour.", "thistlebeck-bridge"),
    ],
    reward: {
      coin: 55,
      itemId: "hallowfield-buckle",
      songId: "until-it-leads-me-home",
      loreId: "hallowfield",
      note: "Fifty-five coppers, a buckle the plough turned up, and a verse with a year in it, which is more than that field has had in four centuries.",
    },
  },
  {
    id: "a-stone-for-the-cairn",
    title: "A Stone for the Cairn",
    giverId: "hawkstone-cairn",
    regionId: "kestrel-march",
    body: "Carry one up. Not from the scree by the cairn — that is cheating and everybody who has done it knows they did. From below the ridge, where it is a real carry. It proves nothing and it is owed to nobody and I have done it eleven times.",
    reward: {
      coin: 0,
      loreId: "the-hawkstone-cairn",
      note: "Nothing at all. He is very clear about that, and he will watch you do it.",
    },
    repeatable: true,
  },
  {
    id: "the-cup-on-the-ledge",
    title: "The Cup on the Ledge",
    giverId: "anchorites-cell",
    regionId: "kestrel-march",
    body: "There is a cup on the ledge inside that cell and it is not an old cup. Somebody carries water up to a walled-in cave that has had nobody in it for two hundred years, and they have been doing it long enough to wear a path I can find and cannot follow. I have sat out three seasons and not seen them. I am not sitting out a fourth. Wait for them. Do not speak first. And if they would rather not be spoken to, then come away and tell me only that they exist.",
    steps: [
      step("wait", "Wait out the dusk on the ledge above the cell, where you are not in the light.", "anchorites-cell"),
      step("let", "Let them go past you. That is the hard part and it is the whole errand.", "anchorites-cell"),
      step("tell", "Come back and tell him only what he is owed, which may be one word.", "kestrel-march"),
    ],
    reward: {
      coin: 0,
      itemId: "key-to-nothing",
      loreId: "the-anchorites-cell",
      note: "Not a copper. He will hand you an iron key to a door that fell down before the wall was old, and he will mean something by it, and he will not say what.",
    },
  },
  {
    id: "the-crow-count",
    title: "The Crow Count",
    giverId: "crowtarn",
    regionId: "greyneedle",
    body: "Three circles of the tarn, every dusk, and then they drop. Three. I have watched forty evenings of it and I have never seen two and I have never seen four. Stand here three nights running and count with me, and if you get a four I will give you everything in my purse, and I will not be pleased about it.",
    steps: [
      step("night-one", "Count the circles at dusk. Do not count out loud.", "crowtarn"),
      step("night-two", "Again the next evening.", "crowtarn"),
      step("night-three", "And the third. Then tell him what you saw, honestly.", "crowtarn"),
    ],
    reward: {
      coin: 15,
      loreId: "the-crows-of-crowtarn",
      songId: "until-it-leads-me-home",
      note: "Fifteen coppers, and the oldest song he knows, played by a black tarn at dusk, which is where it was meant to be heard.",
    },
  },
  {
    id: "count-the-fallen",
    title: "Count the Fallen",
    giverId: "deadfall",
    regionId: "greyneedle",
    body: "Nine hundred trees, everybody says. Nobody has counted. The priory wrote down the hour it happened and not the size of it, and in forty years the only thing left of that night will be a number somebody invented — probably me, if nobody does better, and I would rather it were not me. Peg out one strip across the swathe, count what is down in it, and multiply honestly. Give me a number you would still stand behind in front of a man who was there.",
    steps: [
      step("peg", "Peg a strip clean across the swathe, edge to edge, and measure its width.", "deadfall"),
      step("count", "Count the fallen inside it. Then count them again, coming back the other way.", "deadfall"),
      step("write", "Take the number to the priory and have it written into the book beside the hour.", "priory"),
    ],
    reward: {
      coin: 26,
      itemId: "charcoal-half-peck",
      loreId: "the-night-the-wood-went-over",
      note: "Twenty-six coppers, half a peck of charcoal off the burners' hearth, and a number in a book instead of a number in a song.",
    },
  },
  {
    id: "the-weather-book",
    title: "The Weather Book",
    giverId: "priory",
    regionId: "greyneedle",
    body: "Four hundred years of weather in one book in that room, and nine men who will not lend it, and meanwhile the fen and the pass and every farm in this valley are making the same guesses their grandfathers made. I am not asking you to take it. I am asking you to copy out the years the pass shut — all of them, one line each, nothing else — and put the copy in the hands of the woman in the last cottage below Skarn Pass, who at present is guessing with her eyes.",
    steps: [
      step("ask", "Ask the brother who talks. Then ask him again the next day, which is the actual method.", "priory"),
      step("copy", "Copy every year the pass shut. That column only. Do not improve it.", "priory"),
      step("carry", "Carry it to the last cottage and do not stay to be thanked for it.", "snow-gate-cottage"),
    ],
    reward: {
      coin: 40,
      itemId: "nine-herb-physic",
      songId: "until-it-leads-me-home",
      loreId: "the-rule-and-the-bell",
      note: "Forty coppers, a physic of nine herbs off the infirmarer, and the walking song played inside the wall, which he has never been allowed to do.",
    },
  },
  {
    id: "carry-the-post",
    title: "Carry the Post",
    giverId: "skarn-pass",
    regionId: "skarnfell",
    body: "The pass has been shut eleven weeks and there is a sack of letters in the last cottage that has been shut with it. The first through when it opens carries the post, for nothing, and there has never once been a year without a volunteer. I would do it myself but I am slow and there are letters in there from people waiting on an answer, and one of the hands on the front of them is shaking.",
    steps: [
      step("watch", "Wait with the woman who decides when it opens. Do not hurry her.", "skarn-pass"),
      step("cross", "Take the sack over the first morning the snow gate lifts.", "high-snows"),
      step("deliver", "Get it down to the north farms before the light goes.", "greyneedle-wood"),
    ],
    reward: {
      coin: 0,
      itemId: "skarnfell-cap",
      loreId: "the-snow-gate",
      note: "Not a copper — that is the whole arrangement. A wool cap off her own sheep, and the pass will remember you.",
    },
  },
  {
    id: "bring-them-down",
    title: "Bring Them Down",
    giverId: "whinstone-fold",
    regionId: "skarnfell",
    body: "The gate shuts in nine days, there is a flock in that fold, and there is one shepherd with a knee that will not take the descent. The arithmetic of that is not complicated. It is a long day, mostly downhill, mostly shouting, and nobody will ever sing about it. If it is not done, a man winters on this fell with four hundred sheep and a wall. This valley has two names for men that happened to, and it does not say them often.",
    steps: [
      step("gather", "Gather the fold at first light, before the wind gets into them.", "whinstone-fold"),
      step("drive", "Take them down the Skarnfoot road and be off the top before the light goes.", "skarnfoot"),
      step("count", "Count them into the low pasture. Twice, and out loud, and let him hear the number.", "skarnfoot"),
    ],
    reward: {
      coin: 35,
      itemId: "hobnails",
      loreId: "the-whinstone-fold",
      note: "Thirty-five coppers and a palmful of hobnails with the punch to set them, because he watched how you came down that road.",
    },
  },
  {
    id: "the-tenth-stone",
    title: "The Tenth Stone",
    giverId: "hollowmoor-stones",
    regionId: "hollowmoor",
    body: "Nine stones and a gap on the north side wide enough for a tenth. The moor families will not have the gap dug and I would not ask them to. But eight miles west there is the bed the nine were quarried out of, and if a tenth was ever cut it is lying there still, and knowing that is not the same as disturbing anything.",
    steps: [
      step("measure", "Measure the gap. Properly, with a cord, not with your arms.", "hollowmoor-stones"),
      step("bed", "Find the rock bed west of the moor where the nine were cut.", "tarnwild-edge"),
      step("match", "Look for a stone half-cut and left. Bring the measurements back.", "hollowmoor-stones"),
    ],
    reward: {
      coin: 25,
      itemId: "rowan-charm",
      loreId: "the-nine-at-hollowmoor",
      note: "Twenty-five coppers, a rowan charm from the woman on the moor, and one of the very few answers this valley still has left in it.",
    },
  },
  {
    id: "where-the-water-went",
    title: "Where the Water Went",
    giverId: "sweetwell",
    regionId: "hollowmoor",
    body: "Sweetwell stopped one summer and came back six weeks later forty paces west of where it had been, and the moor families carried the stones and the cup across to it and have not discussed it since. I would like to know where it went in those six weeks. Water does not stop. It goes somewhere else, and somewhere else was wet that year and the rushes will still be wrong. Walk the fall of the ground and find it. I will not put it in a song. I would like that understood before you start.",
    steps: [
      step("head", "Find the old head. It is under the stones they moved, and they moved them tidily.", "sweetwell"),
      step("fall", "Walk the fall of the ground below it and look for rushes standing where no rushes should.", "peat-cuttings"),
      step("tell", "Tell him. Only him. That was the condition and he meant it.", "sweetwell"),
    ],
    reward: {
      coin: 30,
      itemId: "sweetwell-water",
      loreId: "the-spring-that-moved",
      note: "Thirty coppers and a stoppered flask off the spring itself, and a promise kept, which from him is the more expensive of the two.",
    },
  },
  {
    id: "dry-wood-for-wolfpine",
    title: "Dry Wood for Wolfpine",
    giverId: "wolfpine-camp",
    regionId: "tarnwild",
    body: "Before we go: split a stack and put it under the flat stone, out of the wet. Somebody will come through here in three weeks shaking and unable to feel their hands, and they will find it, and they will never know it was us. That is the arrangement out here. I have been on the other end of it and I would rather not tell you about that evening.",
    steps: [
      step("split", "Split enough for one night and one morning. Not more — it rots.", "wolfpine-camp"),
      step("stack", "Under the flat stone, bark side up, and clear the ring while you are at it.", "wolfpine-camp"),
    ],
    reward: {
      coin: 12,
      itemId: "dry-kindling",
      loreId: "somebodys-fire",
      note: "Twelve coppers he will insist on and a bundle of his own kindling he will insist harder on.",
    },
    repeatable: true,
  },
  {
    id: "the-last-milestone",
    title: "The Last Milestone",
    giverId: "westward-mile",
    regionId: "tarnwild",
    body: "Eleven miles, it says, and it does not say to what, and the road under it gives out in bracken two hundred paces on. So: eleven miles west. Walk it and tell me what is there. I have started this three times and turned back three times, and I am not going to pretend to you that it was the weather.",
    steps: [
      step("out", "Take the line the stone faces and hold it. West, eleven miles.", "westward-mile"),
      step("look", "Look for a wall, a ditch, a hearth — anything cut by a hand.", "westward-mile"),
      step("back", "Come back and tell him the truth about what you found.", "westward-mile"),
    ],
    reward: {
      coin: 50,
      itemId: "mostly-right-map",
      loreId: "the-last-milestone",
      songId: "until-it-leads-me-home",
      note: "Fifty coppers and his map, which he will hand over without a word if you tell him there was nothing there.",
    },
  },
];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The quests offered at a place. */
export function questsFor(
  locationId: string | undefined,
  catalogue: Quest[] = DEFAULT_QUESTS
): Quest[] {
  if (!locationId) return [];
  return catalogue.filter((quest) => quest.giverId === locationId);
}

export function questsInRegion(
  regionId: string,
  catalogue: Quest[] = DEFAULT_QUESTS
): Quest[] {
  return catalogue.filter((quest) => quest.regionId === regionId);
}

export function questById(
  id: string,
  catalogue: Quest[] = DEFAULT_QUESTS
): Quest | undefined {
  return catalogue.find((quest) => quest.id === id);
}

// ---------------------------------------------------------------------------
// Project overrides
// ---------------------------------------------------------------------------

/** A row of the `quests` table. */
export type ProjectQuest = {
  id?: string | null;
  title?: string | null;
  body?: string | null;
};

function parseCoin(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** Lays a project's `quests` rows over `DEFAULT_QUESTS`. */
export function resolveQuests(
  projectQuests: ProjectQuest[] | null | undefined,
  options: ResolveOptions = {}
): Quest[] {
  const rows = (projectQuests || []).filter((row) => (row?.title || "").trim());

  const overrides = new Map<string, ProjectQuest>();
  for (const row of rows) overrides.set(slug(row.title as string), row);

  const toQuest = (row: ProjectQuest, base?: Quest): Quest => {
    const { meta, body } = parseDirectives(row.body || "");
    const stepTexts = splitList(meta.steps);
    const id = base?.id ?? slug(row.title as string);
    const coin = parseCoin(meta.coin);

    const reward: QuestReward = {
      coin: coin ?? base?.reward.coin,
      itemId: meta.item ?? base?.reward.itemId,
      songId: meta.song ?? base?.reward.songId,
      loreId: meta.lore ?? base?.reward.loreId,
      note: meta.reward ?? base?.reward.note ?? "",
    };

    return {
      id,
      title: (row.title as string).trim(),
      body: body || base?.body || "",
      giverId: meta.giver ?? base?.giverId ?? "",
      regionId: meta.region ?? base?.regionId,
      steps: stepTexts.length
        ? stepTexts.map((text, i) => step(`${id}-${i + 1}`, text, meta.giver ?? base?.giverId))
        : base?.steps,
      reward,
      repeatable: meta.repeatable ? meta.repeatable !== "false" : base?.repeatable,
      origin: "project",
      rowId: row.id || undefined,
    };
  };

  if (options.mode === "replace") return rows.map((row) => toQuest(row));

  const merged: Quest[] = DEFAULT_QUESTS.map((quest) => {
    const row = overrides.get(slug(quest.title)) ?? overrides.get(quest.id);
    if (!row) return { ...quest, origin: "default" as const };
    overrides.delete(slug(quest.title));
    overrides.delete(quest.id);
    return toQuest(row, quest);
  });

  for (const row of rows) {
    const key = slug(row.title as string);
    if (!overrides.has(key)) continue;
    overrides.delete(key);
    merged.push(toQuest(row));
  }

  return merged;
}
