// Ordinary English words (base forms), for lib/contacts.ts: a word right after an app name ("Instagram addict",
// "Telegram groups are chaos", "snap decisions") or right before "on <app>" is a handle only when it is not one of
// these. Inflected forms ("groups", "decided", "posting", "happier") are found through `isCommonWord`. Hand-picked
// everyday words; some are names too (grace, hope, mark, will, river), which is the trade-off: such a handle is kept
// where nothing but an app name is next to it ("hope on insta"), and removed where the text says a handle follows
// ("insta: hope", see lib/contacts.ts). Words that are mostly first names (dev, miles, king) are not words in those
// places. Plus the words of bios at Edge City India (Goa places, foods, activities), the quiz's interest options, chat
// abbreviations and app vocabulary. On top of these, the ~15,000 most frequent English words (lib/common-words-freq.ts,
// first names and surnames taken out). Server-only, like lib/contacts.ts.
import { FREQUENT, NAME_FORMS } from "./common-words-freq.ts";

const WORDS = `
a i able about above abroad absolute absolutely abstract academic accent accept access accident accommodation according
account accurate ache achieve acid acoustic acquire across act action active activist activity actor actress actual
actually acute adapt add addict addiction addition address adjust admin admire admit adopt adult advance advanced
advantage adventure adventurous advert advertise advertising advice advise advisor aesthetic affair affect afford
afraid africa after afternoon afterwards again against age aged agency agenda agent aggressive ago agree agreement
ahead aid aim air airbnb airport aka alarm album alcohol alert algorithm alien alike alive all allergic allow almost
alone along aloud already alright also alter alternative although altogether always am amateur amazed amazing
ambient ambition ambitious among amount amused an analog analogue analysis analyst ancient and anger angle angry
animal animation ankle anniversary announce annoy annoying annual another answer anti anxiety anxious any anybody
anymore anyone anything anytime anyway anywhere apart apartment app apparently appeal appear appetite applause apple
application apply appointment appreciate approach appropriate approve architect architecture area argue argument
arise arm army around arrange arrangement arrest arrive arrogant art article artificial artist artistic artsy as
ash ashamed aside ask asleep aspect assistant assume at ate atmosphere attach attack attempt attend attention attitude
attract attractive audience audio aunt authentic author auto automatic autumn available avenue average avid avoid
awake award aware away awesome awful awkward baby back background backpack backpacker backyard bad badly bag bake
baker bakery balance balcony bald ball ballet balloon ban banana band bank bar barbecue bare barefoot barely bargain
bark base based basement basic basically basket bass bat bath bathroom battery battle bay be beach beam bean bear
beard beat beautiful beauty became because become bed bedroom bee beef beer before beg began begin beginner beginning
behave behaviour behavior behind being belief believe bell belly belong below belt bench bend beneath benefit berry
beside besides best bet beta better between beyond bicycle bid big bike bill bin bio biology bird birth birthday
biscuit bit bite bitter black blade blame blank blanket blend bless blind block blog blogger blonde blood bloom blow
blue blues board boat body boil bold bond bone bonfire bonus book booking boom boost boot border bored boring born
borrow boss both bother bottle bottom bought bounce bound bowl box boy brain branch brand brave bread break breakfast
breath breathe breeze brew brick bridge brief bright brilliant bring broad broke broken brother brought brown brunch
brush bubble bucket budget bug build builder building built bulk bunch burger burn burnout burst bury bus bush
business busy but butter butterfly button buy buzz by bye cab cabin cafe cake call calm came camera camp campaign
camping can cancel candle candy cap capable capital captain capture car card care career careful careless cargo
carpet carry cart cartoon case cash cast castle casual cat catch category cause cave cease ceiling celebrate
celebrity cell center centre central century ceremony certain certainly chain chair chaise challenge champion chance
change channel chaos chaotic chapter character charge charity charm charming chart chase chat cheap cheat check
cheek cheer cheerful cheese chef chemical chemistry chess chest chicken chief child childhood chill chilled chin chip
chocolate choice choir choose chop chorus chose chosen church cigarette cinema circle circus citizen city civil claim
clap class classic classical clay clean clear clearly clever click client cliff climate climb climber clinic clip
clock close closed closely cloth clothes clothing cloud cloudy club clue clumsy coach coast coat code coffee coin cold
collab collaborate collaboration collapse collar colleague collect collection collective college colour color colorful
colourful column combination combine come comedy comfort comfortable comic command comment commerce commercial
commit commitment common communicate communication community commute company compare comparison compete competition
competitive complain complaint complete completely complex complicated compose composer computer concentrate concept
concern concert conclusion condition conference confidence confident confirm conflict confused confusing connect
connection conscious consider consistent constant constantly construct consult consultant consume contact contain
content contest context continue contract contrast contribute control convenient conversation convince cook cookie
cooking cool cooperate cop cope copy core corn corner correct cost costume cosy cozy cottage cotton couch cough could
council count counter country couple courage course court cousin cover cow crack craft crafty crash crawl crazy cream
create creative creator creature credit crew crime criminal crisis crisp critic critical crop cross crowd crowded
crown crucial cruel cruise crush cry crypto cuddle culture cup cupboard cure curious curly current currently curry
curse curtain curve cushion custom customer cut cute cycle cycling dad daily damage damp dance dancer danger dangerous
dare dark darling dash data date daughter dawn day dead deadline deaf deal dear death debate debt decade decent decide
decision deck declare decline decorate deep deeply deer default defeat defend define definitely degree delay delete
deliberate delicate delicious delight deliver delivery demand demo dense dentist deny depart department depend
depressed depth describe desert deserve design designer desire desk despite dessert destination destroy detail
detailed detective determine develop developer development device devil devoted diary dice did die diet differ
difference different difficult dig digital dinner dip direct direction directly director dirt dirty disagree
disappear disappointed disaster discount discover discovery discuss discussion disease dish dislike dismiss display
distance distant distinct district disturb dive diver divide diving divorce dizzy do doc doctor document documentary
does dog doing dollar domestic done door dose dot double doubt dough down download downstairs downtown dozen draft
drag drain drama dramatic drank draw drawer drawing dream dreamer dress drift drink drive driver drop drove drown
drug drum drummer drunk dry duck due dull dumb dump during dust duty dye each eager ear early earn earth ease easily
east eastern easy eat eaten echo eco economic economy edge edit edition editor educate education effect effective
effort egg eight either elbow elder elderly elect election electric electricity electronic elegant element elephant
else elsewhere email embarrassed embrace emerge emergency emotion emotional empire employ employee employer empty
enable encourage end ending endless enemy energy engage engine engineer engineering enjoy enormous enough ensure
enter entertain entertainment enthusiast entire entirely entrance entry envelope environment episode equal equally
equipment era error escape especially essay essential establish estate estimate ethic ethical even evening event
eventually ever every everybody everyday everyone everything everywhere evidence evil exact exactly exam examine
example excellent except exchange excited excitement exciting excuse execute exercise exhausted exhibition exist
exit exotic expand expect expensive experience experiment expert explain explode explore explorer expose express
expression extend extra extreme extremely eye fabric face fact factor factory fade fail failure faint fair fairly
faith fake fall false fame familiar family famous fan fancy fantastic fantasy far fare farm farmer fashion fast fat
fate father fault favour favor favourite favorite fear feast feather feature fed fee feed feel feeling feet fell
fellow felt female fence festival fetch fever few fiction field fierce fight figure file fill film final finally
finance financial find fine finger finish fire firm first fish fishing fit fitness five fix flag flame flash flat
flavour flavor flee flesh flew flight float flood floor flour flow flower flu fluent fly focus fog fold folk follow
follower fond food fool foolish foot football for force foreign forest forever forget forgive forgot fork form formal
former formula forth fortune forum forward fought found founder fountain four fox frame frank free freedom freelance
freelancer freeze fresh fridge friend friendly friendship fries frog from front frozen fruit frustrated fry fuel full
fully fun function fund funny fur furniture further future gain gallery game gaming gap garage garbage garden
gardener gas gate gather gave gaze gear geek gender general generally generation generous gentle gently genuine
genuinely geography get gift giant girl give given glad glance glass global glory glove glow go goal goat god gold
golden golf gone good goodbye goods goofy gorgeous gossip got govern government grab grace grade gradually graduate
grain grand grandfather grandmother grant graph graphic grass grateful grave great green greet grew grey gray grief
grill grin grind grip groove gross ground group grow growth guarantee guard guess guest guide guilt guilty guitar
gulf gum gun guru guy gym habit had hair half hall hammer hand handle handmade handsome hang happen happily happiness
happy harbour harbor hard hardly harm harmony harsh harvest has hat hate have hay he head headline heal health
healthy hear heard heart heat heaven heavy hedge heel height held hell hello helmet help helpful hence her herb here
hero hers herself hey hi hidden hide high highlight highly hike hiker hiking hill him himself hint hip hire his
history hit hobby hold hole holiday hollow holy home homemade homework honest honestly honey honour honor hook hope
hopefully horizon horrible horror horse hospital host hostel hot hotel hour house household how however hug huge
human humble humour humor hundred hung hunger hungry hunt hurry hurt husband hut hype ice idea ideal identify identity
idle if ignore ill illegal illness illustrate illustration illustrator image imagine immediate immediately impact
import important impossible impress impression improve improv in inch include including income increase incredible
indeed independent index indie individual indoor industry influence influencer info inform informal information
initial injury ink inner innocent input insect inside insight insist inspire inspiration install instance instant
instead institute instruction instrument insurance intelligent intend intense intention interest interested
interesting internal international internet interview into intro introduce introvert invent invest investigate
investment investor invite involve iron island issue it item its itself jacket jam jar jaw jazz jealous jeans jewel
job jog join joint joke journal journalist journey joy judge judgement judgment juice jump jungle junior junk just
justice keen keep kept key kick kid kill kind kindness king kingdom kiss kit kitchen kite knee knew knife knock know
knowledge known lab label labour labor lack ladder lady laid lake lamp land landscape lane language lap laptop large
largely laser last late lately later latest laugh launch laundry law lawn lawyer lay layer lazy lead leader leaf
league lean learn learner least leather leave lecture led left leg legal legend lemon lend length less lesson let
letter level liberal library licence license lid lie life lifestyle lift light like likely limit line link lion lip
liquid list listen listener literally literature little live lively living load loan local lock lonely long look
loop loose lord lose loss lost lot loud lounge love lovely lover low loyal luck lucky lunch lung luxury lying
machine mad made magazine magic magical mail main mainly maintain major majority make maker male mall man manage
manager mango manner many map marathon march mark market marriage married mask mass massage massive master match
mate material math maths matter maximum may maybe me meal mean meaning meant meanwhile measure meat mechanic media
medical medicine meditate meditation medium meet meeting member membership memory men mental mention mentor menu mere
merely mess message messy met metal method middle midnight might mild mile milk mind mine mini minimal minimum minor
minute mirror miss mission mistake mix mixed mobile mode model modern moment money monk monkey month mood moon moral
more moreover morning most mostly mother motion motivate motivation motor mountain mouse mouth move movement movie
much mud mum museum mushroom music musical musician must my myself mystery naked name narrow nasty nation national
native natural naturally nature naughty navy near nearby nearly neat necessary neck need needle negative neighbour
neighbor neither nephew nerd nerve nervous nest net network never nevertheless new newly news newspaper next nice
niece night nightmare nine no nobody nod noise noisy nomad none nonsense noon nor normal normally north nose not
note nothing notice novel now nowadays nowhere nuclear number nurse nut obey object obsessed obsession obvious
obviously occasion occasional occasionally ocean odd of off offer office officer official often oil okay ok old
olive on once one ongoing onion online only onto open opening opera operate operation opinion opponent opportunity
oppose opposite option or orange order ordinary organic organise organize organisation organization origin original
originally other otherwise ought our ours ourselves out outdoor outdoors outer outfit outside oven over overall
overrated overseas overthink owe own owner pace pack package pad page paid pain painful paint painter painting pair
palace pale palm pan panic pants paper parade parent park parking part partly partner party pass passenger passion
passionate passport past pasta patch path patience patient pattern pause pay peace peaceful peak pea peanut pen
pencil people pepper per perfect perfectly perform performance performer perhaps period permanent permission person
personal personality personally perspective pet phase philosophy phone photo photograph photographer photography
phrase physical physics piano pick picnic picture pie piece pig pile pill pillow pilot pin pink pipe pitch pity
pizza place plain plan plane planet plant plastic plate platform play player playlist pleasant please pleased
pleasure plenty plot plus pocket podcast poem poet poetry point poison pole police policy polish polite political
politics pool poor pop popular population pork port portrait pose position positive possible possibly post poster
pot potato potential pottery pound pour powder power powerful practical practice practise praise pray prayer prefer
pregnant prepare present president press pressure pretend pretty prevent previous previously price pride priest
primary prince princess principle print prior priority prison private prize probably problem process produce
producer product production profession professional professor profile profit program programme progress project
promise promote prompt proof proper properly property proposal propose protect protest proud prove provide public
publish pull pump punch punk pure purple purpose push put puzzle quality quantity quarter queen question queue quick
quickly quiet quietly quit quite quiz quote race racing radio rage rail rain rainbow raise ran random range rank rapid
rare rarely rat rate rather raw reach react read reader reading ready real realise realize reality really reason
reasonable recall receive recent recently recipe recognise recognize recommend record recover recovery red reduce
refer reflect refresh refuse regard region regret regular regularly reject relate relation relationship relative
relax relaxed release relevant reliable relief religion religious rely remain remark remember remind remote remove
rent repair repeat replace reply report represent request require rescue research researcher reserve resident resist
resort resource respect respond response responsible rest restaurant result retire retreat return reveal review
rhythm rice rich rid ride rider ridiculous right ring rise risk river road roam roast rob rock rocket role roll
romance romantic roof room root rope rough round route routine row royal rub rubbish rude ruin rule run runner rural
rush sad safe safety said sail sailing salad salary sale salt same sample sand sandwich sat satisfy sauce save saw
say scale scan scared scary scene schedule scheme school science scientist score scream screen script sea seafood
search season seat second secret secretary section secure security see seed seek seem seen select self sell send
senior sense sensible sensitive sent sentence separate series serious seriously servant serve service session set
settle seven several severe sew sex shade shadow shake shall shallow shame shape share sharp she shed sheep sheet
shelf shell shelter shift shine ship shirt shock shoe shoot shop shopping shore short shot should shoulder shout show
shower shut shy sick side sigh sight sign signal silence silent silk silly silver similar simple simply since sing
singer single sink sir sister sit site situation six size skate skating sketch ski skill skin skip skirt sky sleep
slice slide slight slightly slim slip slow slowly small smart smell smile smoke smooth snack snake sneak snow so soap
social society sock sofa soft software soil solar sold soldier solid solo solution solve some somebody somehow
someone something sometimes somewhat somewhere son song soon sore sorry sort soul sound soup sour source south space
spare speak speaker special species specific speech speed spell spend spent spice spicy spider spin spirit spiritual
spirituality spite split spoke sponsor spoon sport spot spread spring square squeeze stable stack staff stage stair
stall stamp stand standard star stare start state statement station status stay steady steal steam steel steep step
stick sticker still stir stock stomach stone stood stop store storm story straight strange stranger strategy straw
stream street strength stress stretch strict strike string strip stroll strong structure struggle stuck student
studio study stuff stupid style subject submit substance succeed success successful such suck sudden suddenly suffer
sugar suggest suit summer sun sunny sunrise sunset super supply support suppose sure surely surf surface surfer
surfing surprise surprised surround survey survive suspect swap swear sweat sweet swim swimming swing switch sword
symbol system table tackle tag tail take taken tale talent talk tall tank tap tape target task taste tasty taught tax
taxi tea teach teacher team tear tech technical technique technology teen teenager teeth telephone television tell
temple temporary tend tender tennis tension tent term terrible terribly terrific test text than thank thanks that
the theatre theater their theirs them theme themselves then theory therapy there therefore these they thick thief
thin thing think third thirsty this thorough those though thought thousand thread threat three threw thrill throat
through throughout throw thumb thus ticket tide tidy tie tiger tight till time tiny tip tired title to toast today
toe together toilet told tomato tomorrow tone tongue tonight too took tool tooth top topic total totally touch tough
tour tourist toward towards towel tower town toxic toy track trade tradition traditional traffic trail train trainer
training transfer transform translate transport trap travel traveller traveler treasure treat treatment tree trek
trend tribe trick trip trouble truck true truly trust truth try tube tune turn twice twin twist two type typical
typically ugly ultimate umbrella unable uncle under underground understand underrated underwater unfortunately
uniform union unique unit universe university unknown unless unlike unlikely until unusual up update upon upper
upset upstairs urban urge urgent us use used useful useless user usual usually vacation valley valuable value van
variety various vast vegan vegetable vegetarian vehicle venture venue version very via vibe vibes victim video view
village violent virtual visa visible vision visit visitor visual vital voice volume volunteer vote wage wait waiter
wake walk wall wallet wander want war warm warn wash waste watch water wave way we weak wealth weapon wear weather
web website wedding week weekday weekend weekly weigh weight weird welcome well west western wet whale what whatever
wheel when whenever where wherever whether which while whisper white who whoever whole whom whose why wide widely
wife wild wildlife will willing win wind window wine wing winner winter wipe wire wise wish with within without
witness woke woman women won wonder wonderful wood wooden wool word wore work worker world worried worry worse worst
worth would wound wow wrap wrist write writer writing written wrong wrote yard yeah year yell yellow yes yesterday
yet yoga yoghurt yogurt you young your yours yourself youth yummy zero zone zoo
able abundant acai accountant adorable agile airy alley aloe amazing anchor anime aperture appetizer aqua arcade
archive arena aroma arrow artisan asana astrology astronomy attic avocado awhile babe backend badminton bae bagel
baggage bakes balm bamboo bandwidth banjo banter barista barn barrel basil bass batch bazaar beam beanbag beef beet
beginner bestie bias bike binge biohack biscuit bistro blast blessed blink bliss blockchain blooper bloom blossom
blur boardgame bodyboard bohemian bonsai bookish bookworm boot bot bouldering boutique brainstorm brave breakup
breathwork breezy brewery bridge broccoli brownie buddy buff buggy bummer bungalow burrito butterfly cactus cacao
caffeine calendar calligraphy cannabis canoe canvas capoeira cappuccino caption caramel cardio carefree carousel
cashew casino catamaran ceramic ceramics champagne chant charcoal chatbot checklist cheesecake chemist cherry chess
chickpea chilli chili chimney chirp chord chutney cinnamon circuit citrus clarinet classy clever cliffside clubbing
cocktail coconut coder coding coffeeshop collage comeback compost console cookbook copywriter coral cosmic cosplay
couchsurf cove coworker coworking crab cranky crayon crepe cricket critter croissant crossword cruiser crunchy crystal
cuisine cupcake curator curd currency cyber cyclist cynic daydream daydreamer debug decor deejay delulu desi dev
devops dharma diaspora dimsum diner dino dinosaur disco doodle dope dork dosa downtime drone drumming dumpling dune
dusk dynamo earring easygoing ebook eclectic economist edgy editorial edtech elephant embroidery emoji empath
encore enthusiast entrepreneur espresso essayist ethereal everest expat extrovert fab fairy falafel fam fandom
fantasy farmhouse fashionista feminist fern ferry fiddle filmmaker fintech firefly fishball fisherman flamenco
flashcard flatmate flute fluffy folklore fomo foodie footy forager fossil freediving frenzy frisbee frontend fudge
funk funky galaxy gamer garlic gelato gem genz ghost gig ginger giraffe gizmo glitter glitch gluten goofball gospel
gourmet granola graffiti gratitude gravel groovy grumpy guava gymnast hacker hackathon hackathons hammock handstand
hangout hardware harmonica hashtag headphone headspace heartbreak hedonist hibiscus highway hip hippie hippy hiphop
hobbyist holistic homebody hoodie hopeless hostel houseplant hula humid hummus hustle hustler ikigai indigo indoors
infinity intern introvert ironic itinerary jackfruit jamming jellyfish jetlag jigsaw jiu journaling juggling jukebox
karaoke karma kayak kayaking kettle keyboard kickflip kiln kinda kombucha kook lagoon lantern latte laundry layover
lazybones leftover legit lentil lighthouse limerick linen lofi longboard longevity lotus lowkey lurker lyric lyrics
macro mandala mantra marine market marmalade masala matcha meadow meetup mellow memoir meme memes mentee mermaid
metaverse microbiology midlife millennial mindful mindfulness minimalist misfit mocktail mojito momentum monsoon
moonlight moped mosaic mosquito motorbike muffin multiverse mural muse mushroom mustard mystic nachos napkin nap
naturalist nectar neon nerdy newbie newsletter nightlife ninja noodle noodles nostalgia notebook nutmeg nutrition
oasis oatmeal octopus offbeat offline omelette opal orchestra orchid origami outfit overlander overthinker oyster
paddle paddleboard pajama pancake panda papaya paragliding parrot pastry patio pebble pelican penguin peppermint
perfume pesto petal pharmacy philosopher phd pickle pickleball pilates pinball pineapple pirate pistachio pixel
planner playful plushie poker polaroid pomegranate popcorn porch postcard potluck prawn pretzel procrastinate
procrastinator prototype psych psychedelic psychology pudding pun pumpkin puppy quest quirky quokka rafting ramen
rave raver reef reggae reiki retro rickshaw rideshare roadtrip robot robotics rockstar rooftop rosemary rum saffron
saga sailor salsa samosa sandal sapiens sarcasm sardine sauna savvy saxophone scenery scooter scuba seashell seaweed
selfie sensei serene shack shaman shellfish sherbet shimmer shrimp sidekick silicon simp sitcom skateboard
skateboarder sketchbook skyline slackline slam slang sleepy slider sloth smoothie snorkel snorkeling snorkelling
snowboard soccer soda sommelier songwriter sorbet soulful soundtrack sourdough souvenir spaghetti sparkle spinach
spontaneous spreadsheet sprint squash squid stargazing startup startups stew stoic storyteller strawberry streetfood
stretching sublime succulent sugarcane sunbathe sunburn sundowner sunflower sunglasses sunscreen superfood surfboard
sushi swimmer synth synthwave taco tahini tamarind tango tapas tattoo teacup techno telescope terrace textile
theatre thrift thrifting thunder tinker tofu toddler tortoise trance trekker tribe trivia tropical turmeric turtle
tutor typewriter ukulele unicorn upcycle vanilla veggie vibey vinyl violin vlog vlogger volcano volleyball voyage
waffle wallflower wanderer wanderlust wasabi watercolor watercolour waterfall watermelon wellbeing wellness whimsical
wifi windsurf wingman wizard woodwork workaholic workout workshop wrestler yacht yay yeti yogi yolo zen zine zombie
`;

// The world of bios at Edge City India: Goa and India, food, interests (the quiz's options: lib/options.ts INTEREST_CHIPS).
const LOCAL = `
goa goan mandrem ashwem arambol anjuna vagator morjim assagao panjim panaji mapusa siolim candolim calangute baga
palolem agonda chapora parra aldona pernem keri querim colva benaulim margao vasco hampi gokarna kerala varkala
bangalore bengaluru mumbai bombay delhi pune chennai hyderabad kolkata jaipur rishikesh dharamshala manali ladakh
india indian konkani konkan marathi hindi hinglish kannada tamil malayalam bengali punjabi gujarati sanskrit
chai masala feni bebinca xacuti cafreal vindaloo sorpotel poi pav vada thali biryani dosa idli sambar rasam paneer
dal roti naan paratha chaat pani puri lassi kokum sol kadhi kulfi jalebi ladoo halwa samosa pakora kebab tikka korma
fish curry prawn bhaji misal poha upma
yoga ayurveda kirtan bhajan raga tabla sitar kathak bharatanatyam odissi kathakali carnatic hindustani qawwali
bollywood tollywood ashram satsang pranayama vipassana tantra chakra sadhu diwali holi navratri ganesh onam
ai crypto startups startup building hacking content creation music art fitness wellness surfing beach travel food
books philosophy science spirituality parties nature gaming photography edge city village resident residents
ml llm llms agent agents agentic web3 defi dao daos nft nfts zk eth btc solana bitcoin ethereum
`;

// Chat words and what apps are made of ("WhatsApp? nah", "IG broadcast channel", "Snap Inc", "tg airdrop").
const CHAT = `
lol lmao lmfao rofl haha hahaha hehe omg omfg idk idc tbh imo imho btw ngl irl rn fyi jk smh ikr nah nope yep yup yeah
yah meh ugh oops oof bruh dude bro sis babe hun plz pls thx ty np gm gn wagmi ngmi
reel filter story highlight broadcast collab algorithm aesthetic baddie inc hq corp labs airdrop hamster ton
tiktok youtube facebook reddit twitter linkedin discord github bluesky substack medium threads pinterest spotify
signal skype zoom slack notion figma canva netflix uber zomato swiggy paytm gpay upi
spectacle lens grid caption hashtag swipe scroll doomscroll lurk lurker lurking shitpost meme dump carousel repost
`;

const MORE = `
portfolio streak presence viral mute unmute silent ghost ghosted scam scammer spam bookmark forward forwarding
notify skeptic sceptic cynic compress pod folder grammar archive inbox outbox unread spam pin pinned emoji gif
font crackle sometime nobel hiatus inspo algo vibe vibing supreme court advocate encrypt encryption regulate privacy
competitor autocorrect enjoyer
monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thurs fri sat sun
january february march april june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec
`;

// Chat abbreviations people write right after an app name ("insta ppl", "tg pfp", "ig fyp", "insta til i die").
const SLANG = `
cuz coz bc tho thru til till ppl pfp fyp ootd grwm lmk tmi tldr af asf istg fr frfr nvm ofc pov ic omw wyd hbu hmm hmmm pfft
dunno gonna wanna gotta kinda sorta lemme ya yall y'all u ur r k kk ok okk okay okie hmu dm dms msg exhaust
cant can't wont won't dont didnt doesnt isnt havent wasnt gr8 sk8 l8r b4 detox detoxing
hey hi hello hii heyy hiya sms imessage mms
`;

// Hinglish and other languages' small words, which bios here mix in ("insta toh dead hai", "insta aur whatsapp dono
// band", "tg me sab crypto wale hain", "insta casi nunca", "insta und tg"). Never names, so never handles either.
const OTHER_LANGUAGES = `
aur hai hain nahi nahin nhi bhi toh mein par pe pr ka ki ke wala wale wali kar karo karna karti karta na sab kuch
bahut bohot yaar yar bhai mera meri mere hoon hu hun se ko kya kyun kab jab tab ab abhi phir fir bas hi tha thi
accha acha achha theek thik chalo chal haan ha dono kabhi sirf zyada log logon wahan yahan
dekho dekhti dekhta pata nai hota hoti itne itna itni tum aap hum unka uska iska kitna kitne pagal ho hogaya ye yeh woh wo
kijiye
y o casi nunca siempre pero con sin muy und oder aber nicht ja nein mit sehr et ou mais avec sans tres très com sem não nao
`;
// Words that are first names as often as words ("Dev", "Miles", "King", and Hindi words that are names: Diya, Raha,
// Koi, Kam, Mai, Gaya). Where the patterns look ("diya on insta", "insta, dev for collabs") they stay handles, as before
// QA4 (`isCommonWord`); right after an app name they are words ("Telegram dev here", "insta kam use karti hoon", `isWord`).
const NAMES_TOO = new Set(["dev", "devs", "king", "mile", "miles", "ganesh", "diya", "raha", "rahi", "rahe", "gaya", "gayi", "koi", "kam", "mai"]);

const words = (s: string) => s.split(/\s+/).filter((w) => w && !NAMES_TOO.has(w));
const SET: ReadonlySet<string> = new Set(words(`${WORDS} ${LOCAL} ${CHAT} ${MORE} ${SLANG} ${OTHER_LANGUAGES} ${FREQUENT}`));
const CHAT_SET: ReadonlySet<string> = new Set(words(`${CHAT} ${SLANG} ${OTHER_LANGUAGES}`));
// Names that forms of the frequency list's words would make words ("rashed", "morales", "crocker"): they stay names.
const NOT_WORDS: ReadonlySet<string> = new Set(NAME_FORMS.split(/\s+/).filter(Boolean));

// Describing words: what people say an app is ("Instagram is toxic", "Telegram: muted", "Insta? Nah"). Only these, and
// participles and adverbs of known words ("deleted", "exhausting", "mostly"), count as words where the text says a
// handle follows ("telegram: chai" is a handle). Adjectives are listed, not guessed from endings: "-ic", "-ive", "-ly"
// also end nouns and names (garlic, olive, billy).
const DESCRIBING = new Set(words(`
toxic chaotic aesthetic addictive private public secret hidden sure lit dope fire taken pending boring dead fake real great good bad fine cool nice fun weird lame
basic mid cringe scary ugly pretty cute sweet wild crazy insane awesome awful terrible horrible perfect beautiful gorgeous
lovely important useless pointless endless hopeless harmless mindless careless dangerous famous nervous anxious obvious
serious curious active inactive passive creative expensive massive positive negative quiet loud slow fast busy lazy tired
sick sad happy free open closed empty full new old big small huge tiny rare random strange normal healthy unhealthy optional
essential necessary temporary permanent visible invisible available unavailable reliable relevant irrelevant honest brutal
chill calm wholesome problematic ironic iconic legendary sus overrated underrated broken banned blocked down off on gone
dormant abandoned ancient messy noisy crowded empty awkward chaos trash garbage overkill enough plenty ok okay
everything nothing life love hate work noise hell heaven home cancer poison same different better worse best worst later
never always sometimes rarely often mostly barely hardly sometime someday anytime whenever soon now today tonight tomorrow
`));

// Adjectives whose "-er" / "-est" forms are words ("longer", "faster", "nicest", "bigger": Q5-L1). Listed, as "-er" is
// never cut in general ("oliver", "peter", "potter" are names); not "full", "wild", "kind" ("Fuller", "Wilder", "Kinder").
const GRADABLE = new Set(words(`
long short tall high low old young new fast slow quick soon late early hard soft strong weak cheap rich poor deep wide narrow
warm cool cold hot dark light bright loud quiet calm big small tiny huge large thin fat thick sharp smart dumb safe wise
brave close near far clean clear fresh sweet nice cute pure rare simple gentle weird strange tough rough smooth dry wet
great fine sad mad glad proud loose tight slim neat brief plain fair firm green black white red blue grey gray
`));

/**
 * Base forms of a lower-case word: "groups" → group, "decided" → decide, "running" → run, "happier" → happy. Careful
 * with names: "-er" is never cut ("oliver", "peter", "potter" stay unknown), nor a final "-y" ("billy", "rocky",
 * "sandy"), "-es" only after s, x, z, ch, sh ("james" is not "jam"), and a cut never leaves fewer than 3 letters
 * ("tony", "andy", "jared" stay unknown).
 */
function bases(w: string): string[] {
  const out = [w];
  const add = (b: string, min = 3) => b.length >= min && out.push(b);
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (/(?:[sxz]|ch|sh)es$/.test(w)) add(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
  if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
  if (w.endsWith("eed")) add(w.slice(0, -1), 4); // "freed" → free; "fareed", "rasheed" are no "fare", "rashe"
  else if (w.endsWith("ed")) {
    add(w.slice(0, -2), 4);
    add(w.slice(0, -1), 4);
    if (/([^aeiou])\1ed$/.test(w)) add(w.slice(0, -3)); // "shopped" → shop
  }
  if (w.endsWith("ing")) {
    add(w.slice(0, -3));
    add(w.slice(0, -3) + "e", 4);
    if (/([^aeiou])\1ing$/.test(w)) add(w.slice(0, -4)); // "running" → run
  }
  if (w.endsWith("ings")) add(w.slice(0, -4));
  if (/ier$|iest$/.test(w)) add(w.replace(/iest?$|ier$/, "y")); // "happier" → happy
  if (w.endsWith("ly")) add(w.slice(0, -2), 4);
  if (w.endsWith("ily")) add(w.slice(0, -3) + "y", 4);
  if (w.endsWith("ness")) add(w.slice(0, -4));
  if (w.endsWith("ment")) add(w.slice(0, -4)); // "engagement" → engage
  if (w.endsWith("ication")) add(w.slice(0, -7) + "y"); // "notification" → notify
  if (w.endsWith("ation")) add(w.slice(0, -5) + "e"); // "creation" → create
  if (w.endsWith("ation")) add(w.slice(0, -3) + "e"); // "regulation" → regulate
  if (w.endsWith("ion")) add(w.slice(0, -3)); // "compression" → compress
  if (w.endsWith("ful")) add(w.slice(0, -3));
  return out;
}

/** The forms of a word to look up: its bases, those of its singular ("notifications"), and without un-/re- ("uninstalled"). */
function forms(w: string): string[] {
  const out = /[^s]s$/.test(w) && w.length >= 5 ? [...bases(w), ...bases(w.slice(0, -1))] : bases(w);
  const m = /^(?:un|re)([a-z]{4,})$/.exec(w);
  return m ? [...out, ...forms(m[1])] : out;
}
/** "-er" / "-est" of a GRADABLE adjective: "longer", "nicer" (nice), "bigger" (big), "latest" (late). */
function comparative(w: string): boolean {
  const m = /^([a-z]{2,})(?:er|est)$/.exec(w);
  if (!m) return false;
  const s = m[1];
  return GRADABLE.has(s) || GRADABLE.has(s + "e") || (/([^aeiou])\1$/.test(s) && GRADABLE.has(s.slice(0, -1)));
}
const contraction = (w: string) => (/^(?:can|won)['’]t$/.test(w) ? w : w.replace(/n['’]t$/, "").replace(/['’](?:s|re|ve|ll|d|m|t)$/, ""));

/** An ordinary English (or Goa bio) word, in any common inflected form. Lower-case letters only; anything else is not. */
export function isCommonWord(w: string): boolean {
  if (!/^[a-z]+(?:['’][a-z]+)?$/.test(w) || NOT_WORDS.has(w)) return false;
  const base = contraction(w);
  if (forms(base).some((b) => SET.has(b)) || comparative(base)) return true;
  // A word and a particle: "cleanups", "meetup", "workouts", "takeout", "kickoff" (not two words in general:
  // handles are often made that way, "chaiwaves").
  const m = /^([a-z]{3,})(up|ups|out|outs|off|offs|down|downs|over|overs)$/.exec(base);
  return !!m && SET.has(m[1]);
}

/**
 * A role made from a known word of 5+ letters ("avoider", "survivors", "scroller"). Not part of isCommonWord, which
 * the patterns also use where a name must stay a handle; stems under 5 letters never count ("hunter", "peter", "walker").
 * Also a known "-ist" word ("therapist", "activist", "minimalist": Q5-L1), an ending no name has.
 */
export const isRole = (w: string) => {
  if (NOT_WORDS.has(w)) return false;
  const m = /^([a-z]{5,}?)(?:er|or)s?$/.exec(w);
  return (!!m && (SET.has(m[1]) || SET.has(m[1] + "e"))) || (/^[a-z]{3,}ists?$/.test(w) && SET.has(w.replace(/s$/, "")));
};

/** A word that is a first name as often as a word ("dev", "miles", "diya", "kam"). */
export const isNameWord = (w: string) => NAMES_TOO.has(w);

/** `isCommonWord`, a role, or a word that is also a first name ("dev", "miles"): where nothing but an app name is next to it. */
export const isWord = (w: string) => isCommonWord(w) || isRole(w) || NAMES_TOO.has(w);

/** A chat word or abbreviation ("lol", "nah", "ppl", "fyp", "tiktok"): never a handle, wherever it stands. */
export const isChatWord = (w: string) => CHAT_SET.has(contraction(w));

/**
 * A describing word (listed) or its "-er" / "-est" form ("slower"), or a participle or adverb of a known word of 4+ letters ("deleted", "exhausting",
 * "paintings", "mostly", "uninstalled"; not the names "fareed", "manning", "billy").
 */
export function isDescribing(w: string): boolean {
  if (!/^[a-z]+$/.test(w) || NOT_WORDS.has(w)) return false;
  const core = /^(?:un|re)[a-z]{5,}$/.test(w) ? w.slice(2) : w;
  if (DESCRIBING.has(w) || DESCRIBING.has(core) || CHAT_SET.has(w) || comparative(w)) return true;
  const stems: string[] = [];
  for (const x of new Set([w, core])) {
    if (x.endsWith("eed")) stems.push(x.slice(0, -1)); // "freed" → free (not "fareed" → fare)
    else if (x.endsWith("ied")) stems.push(x.slice(0, -3) + "y");
    else if (x.endsWith("ed")) stems.push(x.slice(0, -2), x.slice(0, -1)); // "posted" → post, "muted" → mute
    const ing = /^(.+?)ings?$/.exec(x);
    if (ing) stems.push(ing[1], ing[1] + "e");
    if (x.endsWith("ily")) stems.push(x.slice(0, -3) + "y");
    else if (x.endsWith("ly")) stems.push(x.slice(0, -2));
  }
  // A doubled consonant before the ending is one letter ("shopped" → shop).
  return stems.flatMap((s) => (/([^aeiou])\1$/.test(s) ? [s, s.slice(0, -1)] : [s])).some((s) => s.length >= 4 && SET.has(s));
}
