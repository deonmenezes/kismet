# Builds src/lib/common-words-freq.ts (QA5 Q5-L1): the most frequent English words that are no name.
#   python scripts/build-common-words.py <cache dir>    (downloads the sources into it once; prints a summary to stderr)
# A word is kept when it is among the 30,000 most frequent words of the OpenSubtitles 2018 English counts
# (hermitdave/FrequencyWords, CC BY-SA 4.0), is itself a lower-case entry of the SCOWL Hunspell dictionaries (en_US or
# en_GB; no derived forms, so "sameer" is not "same" + "er": lib/common-words.ts derives forms itself), and is not:
#   - a capitalised entry there too (a proper noun as well: Bill, Rose, China, Shiva, Talbot),
#   - a US first name of 0.02%+ of births in any year (SSA 1880-2008), in a 4.9k first-name list, an Indian first or
#     last name, one of the 1,000 most common US surnames, or in NAMES below,
#   - an app name, or one letter off one (lib/contacts.ts reads those as misspelt app names).
# Then NAME_FORMS: the names that lib/common-words.ts would take for words only because of the new words ("rashed" from
# rash, "morales" from morale, "crocker" a role from crock), found by running its own predicates without and with the
# list (needs node). lib/common-words.ts keeps them no words.
import csv, os, re, subprocess, sys, urllib.request

SOURCES = {
    "en_50k.txt": "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt",
    "en_US.dic": "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/en/en_US.dic",
    "en_GB.dic": "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/en/en_GB.dic",
    "baby-names.csv": "https://raw.githubusercontent.com/hadley/data-baby-names/master/baby-names.csv",
    "first-names.txt": "https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt",
    "indian-first.txt": "https://raw.githubusercontent.com/MASTREX/List-of-Indian-Names/master/2.%20First.txt",
    "indian-last.txt": "https://raw.githubusercontent.com/MASTREX/List-of-Indian-Names/master/5.%20Last.txt",
    "surnames.csv": "https://raw.githubusercontent.com/fivethirtyeight/data/master/most-common-name/surnames.csv",
}
TOP = 30000
# Names, nicknames and Hindi words used as names that the lists above miss (QA5 review: "Pooja on IG" must stay a handle).
NAMES = set("""woody hank butch niles marcel lex telly anders garth charly jagger nil nils mat mats sameer pooja puja raja
rani shiva ram baba hanuman pinky coco nova sora guru swami deva devi maya karma ananda amrit lakshmi krishna rama sita
kali durga ganga yamuna indra surya chandra laila leela lila mira tara kiran bindi bunty chintu golu sonu monu pappu
babu raju munna chhotu prem shiv nazir rashed hastings crocker dolly bubbles cookie honey sweety sweetie candy angel buddy
ember aria luna willow wren haven harbor harbour journey legend lyric melody harmony serenity trinity genesis eden ocean
phoenix raven hazel ivy iris jade ruby pearl opal olive juniper clover daisy poppy meadow magnolia briar aspen cedar rowan
cove brook reed onyx blaze ace maverick ranger archer hunter knight legacy royal reign saint lux nyx sol stella sunny
indigo bodhi zen kai remy rebel echo arlo milo ezra atlas orion sierra savannah""".split())  # post-2008 baby names (SSA data ends 2008)
APPS = ["telegram", "instagram", "snapchat", "whatsapp", "whatsap", "insta"]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "src", "lib", "common-words-freq.ts")


def fetch(cache):
    os.makedirs(cache, exist_ok=True)
    for name, url in SOURCES.items():
        path = os.path.join(cache, name)
        if not os.path.exists(path):
            urllib.request.urlretrieve(url, path)  # raises on an HTTP error
        start = open(path, encoding="utf-8", errors="replace").read(200)
        if os.path.getsize(path) < 1000 or start.startswith(("404", "<")):  # an error page saved as data
            sys.exit(f"{name}: not the expected data ({os.path.getsize(path)} bytes); delete it and run again")


def dic_entries(path):
    lower, upper = set(), set()
    for line in open(path, encoding="utf-8-sig"):
        w = line.strip().split("/")[0]
        if re.fullmatch(r"[a-z]+", w):
            lower.add(w)
        elif re.fullmatch(r"[A-Z][a-z]+", w):
            upper.add(w.lower())
    return lower, upper


def one_off(a, b):
    if abs(len(a) - len(b)) > 1:
        return False
    i = 0
    while i < len(a) and i < len(b) and a[i] == b[i]:
        i += 1
    if len(a) == len(b):
        return a[i + 1:] == b[i + 1:] or (i + 1 < len(a) and a[i] == b[i + 1] and a[i + 1] == b[i] and a[i + 2:] == b[i + 2:])
    return a[i + 1:] == b[i:] if len(a) > len(b) else b[i + 1:] == a[i:]


def wrap(ws):
    lines, cur = [], ""
    for w in ws:
        if cur and len(cur) + len(w) + 1 > 118:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    return "\n".join(lines + ([cur] if cur else []))


def write(kept, name_forms):
    head = open(OUT, encoding="utf-8").read().split("export const FREQUENT = `")[0]
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"{head}export const FREQUENT = `\n{wrap(kept)}\n`;\n\n"
                "// Names that forms of the words above would make words (scripts/build-common-words.py): never words.\n"
                f"export const NAME_FORMS = `\n{wrap(name_forms)}\n`;\n")


CHECK = """
const m = await import(process.argv[1]);
const names = require("fs").readFileSync(0, "utf8").split(/\\r?\\n/).filter(Boolean);
console.log(names.filter((n) => m.isCommonWord(n) || m.isRole(n) || m.isDescribing(n)).join("\\n"));
"""


def words_of(names):
    """The names lib/common-words.ts takes for words (isCommonWord, isRole or isDescribing), as the file is now."""
    url = "file:///" + os.path.abspath(os.path.join(ROOT, "src", "lib", "common-words.ts")).replace("\\", "/")
    stdin = "\n".join(sorted(n for n in names if re.fullmatch(r"[a-z]+", n)))
    r = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "--input-type=commonjs", "-e",
                        f"(async () => {{ {CHECK} }})()", url], input=stdin, capture_output=True, text=True, check=True)
    return set(r.stdout.split())


def main(cache):
    fetch(cache)
    at = lambda n: os.path.join(cache, n)
    lower, upper = set(), set()
    for d in ("en_US.dic", "en_GB.dic"):
        lo, up = dic_entries(at(d))
        lower |= lo
        upper |= up
    names, share = set(NAMES), {}
    for row in csv.DictReader(open(at("baby-names.csv"), encoding="utf-8")):
        n = row["name"].lower()
        share[n] = max(share.get(n, 0), float(row["percent"]))
    names |= {n for n, v in share.items() if v >= 0.0002}
    for f in ("first-names.txt", "indian-first.txt", "indian-last.txt"):
        names |= {l.strip().lower() for l in open(at(f), encoding="utf-8") if l.strip()}
    for row in csv.DictReader(open(at("surnames.csv"), encoding="utf-8")):
        if int(row["rank"]) <= 1000:
            names.add(row["name"].lower())
    kept, why = [], {"not a dictionary entry": 0, "proper noun too": 0, "name": 0, "app-like": 0}
    for rank, line in enumerate(open(at("en_50k.txt"), encoding="utf-8")):
        if rank >= TOP:
            break
        w = line.split(" ")[0]
        if not re.fullmatch(r"[a-z]{3,}", w):
            continue
        reason = ("not a dictionary entry" if w not in lower else "proper noun too" if w in upper else "name" if w in names
                  else "app-like" if any(w == k or one_off(w, k) for k in APPS) else None)
        if reason:
            why[reason] += 1
        else:
            kept.append(w)
    kept = sorted(set(kept))
    print(f"top {TOP}: kept {len(kept)}; left out: {why}", file=sys.stderr)
    write([], [])
    before = words_of(names)
    write(kept, [])
    name_forms = sorted(words_of(names) - before)
    write(kept, name_forms)
    print(f"names checked {len(names)}; made words only by the new list, kept no words: {len(name_forms)}: {' '.join(name_forms)}",
          file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".omc", "words-cache"))
