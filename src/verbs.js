// Verb-pattern question generator.
//
// Sentences are built from tagged parts so that only combinations that make sense
// are produced:
//   • each main verb lists "frames": the tenses it may appear in, and for each tense
//     the time phrases (or perfect adverbs) that fit it;
//   • each main verb lists the activity tags it can sensibly combine with;
//   • each activity carries tags describing what kind of thing it is.
// The correct answer depends only on the main verb + frame, never on the tense,
// and infinitive answers INCLUDE "to" — the student must type it.
//
// Run `node tools/dump-combos.mjs` to print every pairing for review.

// ───────────── Subjects ─────────────
const SUBJECTS = [
  ["I", 1], ["You", 2, true], ["He", 3], ["She", 3], ["We", 1, true], ["They", 3, true],
  ["My boyfriend", 3], ["My girlfriend", 3], ["My mother", 3], ["My father", 3],
  ["My sister", 3], ["My brother", 3], ["The teacher", 3], ["My friend", 3], ["Our doctor", 3]
].map(([text, person, plural = false]) => ({ text, person, plural }));

const isThirdSingular = (s) => s.person === 3 && !s.plural;
const be = (s) => (s.person === 1 && !s.plural ? "am" : isThirdSingular(s) ? "is" : "are");
const have = (s) => (isThirdSingular(s) ? "has" : "have");
const wasWere = (s) => (s.plural || s.person === 2 ? "were" : "was");

// ───────────── Time phrases ─────────────
// "" means no time phrase at all.
const T = {
  past: ["yesterday", "last weekend", "last night", "on Saturday"],
  habit: ["every weekend", "at the weekend", "on Saturdays", "after school", "every day"],
  // softer habit set for like / love / hate / enjoy / don't mind ("hates sleeping every day" is odd)
  likes: ["at the weekend", "on Saturdays", "after school"],
  now: ["at the moment", "right now"],
  future: ["tomorrow", "this weekend", "next week", "on Saturday"],
  childhood: ["as a child", "years ago"],
  memory: ["as a child", "last summer", "on holiday", "years ago"],
  none: [""]
};

// ───────────── Activities ─────────────
// Tags:
//   leisure  – fun things            food     – eating
//   chore    – jobs / duties         help     – things you do for someone else
//   skill    – things you can learn  ongoing  – activities that can continue (go on)
//   habit    – things you can give up (stop)  task – things with an end point (finish)
//   pretend  – plausible to fake     memory   – memorable one-off experiences
//   go       – fits "go ___ing" (go swimming)  interest – something you could be interested in
//   oneoff   – not something you do habitually, so never paired with "every weekend" etc.
const ACTIVITIES = [];
function act(base, ger, rest, tags) {
  ACTIVITIES.push({ base, ger, rest, tags: tags.split(" ") });
}
act("sleep", "sleeping", "", "leisure ongoing pretend");
act("wait", "waiting", "", "ongoing help");
act("walk", "walking", "home", "leisure");
act("study", "studying", "", "chore ongoing habit task pretend");
act("run", "running", "in the park", "leisure ongoing habit memory go");
act("swim", "swimming", "", "leisure ongoing habit skill go interest");
act("shop", "shopping", "", "leisure go");
act("dance", "dancing", "", "leisure ongoing skill go interest");
act("fish", "fishing", "", "leisure go interest");
act("cycle", "cycling", "", "leisure ongoing skill go interest");
act("swim", "swimming", "in the sea", "leisure memory");

for (const [obj, extra] of [
  ["pizza", "memory"], ["ice cream", "memory"], ["an apple", "task"], ["a sandwich", "task"],
  ["soup", "task"], ["pasta", ""], ["fruit", ""], ["vegetables", ""],
  ["lunch", "task"], ["breakfast", "task"], ["dinner", "task"]
]) act("eat", "eating", obj, `food ongoing habit pretend ${extra}`.trim());

act("buy", "buying", "a new shirt", "leisure oneoff");
act("buy", "buying", "a gift", "leisure help");
act("buy", "buying", "a bike", "leisure memory oneoff interest");
act("buy", "buying", "some food", "chore help");

for (const room of ["the kitchen", "the bedroom", "the house"])
  act("clean", "cleaning", room, "chore help ongoing task");

act("watch", "watching", "a movie", "leisure ongoing task");
act("watch", "watching", "TV", "leisure ongoing habit pretend");
act("watch", "watching", "a football match", "leisure ongoing task memory");

act("cook", "cooking", "dinner", "chore help ongoing task");
act("cook", "cooking", "pasta", "chore help skill task interest");
act("cook", "cooking", "a meal", "chore help skill task");
act("cook", "cooking", "soup", "chore help task");

act("play", "playing", "the guitar", "leisure ongoing skill interest");
act("play", "playing", "video games", "leisure ongoing habit");
act("play", "playing", "tennis", "leisure ongoing skill memory interest");

// ───────────── Main verbs ─────────────
// form: "inf" | "ger" | "both"; a frame may override it.
// tags: activity tags allowed (any match); omitted = any activity.
// frames: [tense, timePhrases, perfectAdverbs?, formOverride?]
//   tenses: presSimple, presCont, past, presPerf, willNever
const F = (tense, times, adv = [""], form) => ({ tense, times, adv, form });
const GENERAL = "leisure food chore skill";   // everyday plans and wishes (excludes "wait")

export const VERBS = [
  { key: "decide", head: "decide", past: "decided", pp: "decided", form: "inf", tags: GENERAL,
    frames: [F("past", [...T.past, ...T.future, ""]), F("presPerf", [""], ["just", "already"])] },
  { key: "forget", head: "forget", past: "forgot", pp: "forgotten", form: "inf", tags: "chore help",
    frames: [F("presSimple", [...T.likes, ""], ["always", "often"]), F("past", [...T.past, "again"]), F("presPerf", ["again", ""])] },
  { key: "hope", head: "hope", ing: "hoping", past: "hoped", pp: "hoped", form: "inf", tags: GENERAL,
    frames: [F("presSimple", T.future), F("presCont", T.future)] },
  { key: "learn", head: "learn", ing: "learning", past: "learned", pp: "learned", form: "inf", tags: "skill",
    frames: [F("past", ["last year", "last summer"]), F("presCont", T.now), F("presPerf", [""], ["just", "already"])] },
  { key: "need", head: "need", past: "needed", pp: "needed", form: "inf", tags: GENERAL,
    frames: [F("presSimple", [...T.habit, ...T.future, ""]), F("past", T.past)] },
  { key: "plan", head: "plan", ing: "planning", past: "planned", pp: "planned", form: "inf", tags: GENERAL,
    frames: [F("presSimple", T.future), F("presCont", T.future), F("past", T.past)] },
  { key: "pretend", head: "pretend", ing: "pretending", past: "pretended", pp: "pretended", form: "inf", tags: "pretend",
    frames: [F("past", T.past), F("presCont", T.now)] },
  { key: "remember (to)", head: "remember", past: "remembered", pp: "remembered", form: "inf", tags: "chore help",
    frames: [F("presSimple", [...T.likes, ""], ["always", "never"]), F("past", ["this time", "for once"])] },
  { key: "would like", fixed: "would like", form: "inf", tags: GENERAL,
    frames: [F("fixed", [...T.future, ""])] },
  { key: "promise", head: "promise", past: "promised", pp: "promised", form: "inf", tags: "chore help",
    frames: [F("past", [...T.past, ...T.future, ""]), F("presPerf", [""], ["just"])] },
  { key: "offer", head: "offer", past: "offered", pp: "offered", form: "inf", tags: "help",
    frames: [F("past", [...T.past, ""]), F("presPerf", [""], ["just"])] },
  { key: "want", head: "want", past: "wanted", pp: "wanted", form: "inf", tags: GENERAL, allowIO: true,
    frames: [F("presSimple", [...T.future, ""]), F("past", T.past)] },

  { key: "enjoy", head: "enjoy", past: "enjoyed", pp: "enjoyed", form: "ger", tags: "leisure food chore",
    frames: [F("presSimple", [...T.likes, ""]), F("past", T.past), F("presPerf", [""], ["always", "never"])] },
  { key: "feel like", head: "feel", particle: "like", past: "felt", pp: "felt", form: "ger", tags: "leisure food",
    frames: [F("presSimple", [...T.now, ""]), F("past", T.past)] },
  { key: "finish", head: "finish", past: "finished", pp: "finished", form: "ger", tags: "task",
    frames: [F("past", T.past), F("presPerf", [""], ["just", "already"])] },
  { key: "go on", head: "go", particle: "on", past: "went", pp: "gone", form: "ger", tags: "ongoing",
    frames: [F("past", ["", "last night", "all afternoon"])] },
  { key: "hate", head: "hate", past: "hated", pp: "hated", form: "ger", tags: GENERAL,
    frames: [F("presSimple", [...T.likes, ""]), F("past", T.childhood), F("presPerf", [""], ["always"])] },
  { key: "like", head: "like", past: "liked", pp: "liked", form: "ger", tags: GENERAL,
    frames: [F("presSimple", [...T.likes, ""]), F("past", T.childhood), F("presPerf", [""], ["always", "never"])] },
  { key: "love", head: "love", past: "loved", pp: "loved", form: "ger", tags: GENERAL,
    frames: [F("presSimple", [...T.likes, ""]), F("past", T.childhood), F("presPerf", [""], ["always"])] },
  { key: "don't mind", head: "mind", negative: true, form: "ger", tags: "chore help",
    frames: [F("presSimple", [...T.likes, ""]), F("past", T.past)] },
  { key: "stop", head: "stop", past: "stopped", pp: "stopped", form: "ger", tags: "habit",
    frames: [F("past", ["last week", "last year", ""]), F("presPerf", [""], ["just"])] },

  // go + -ing: only activities you can "go" and do (go swimming, go shopping).
  { key: "go", head: "go", ing: "going", past: "went", pp: "gone", form: "ger", tags: "go",
    frames: [F("presSimple", T.habit), F("past", T.past), F("presCont", T.future), F("presPerf", [""], ["just"])] },
  // be + adjective + preposition + -ing
  { key: "be good at", be: "good at", form: "ger", tags: "skill",
    frames: [F("presSimple", [""]), F("past", T.childhood), F("presPerf", [""], ["always", "never"])] },
  { key: "be interested in", be: "interested in", form: "ger", tags: "interest",
    frames: [F("presSimple", ["", "at the moment"]), F("past", T.childhood), F("presPerf", [""], ["always"])] },
  { key: "keep", head: "keep", past: "kept", pp: "kept", form: "ger", tags: "habit",
    frames: [F("presSimple", [""]), F("past", ["", "all afternoon", "last night"])] },

  // start: either form — except in the continuous, where "is starting cooking" is avoided.
  { key: "start", head: "start", ing: "starting", past: "started", pp: "started", form: "both", tags: "chore food",
    frames: [F("past", T.past), F("presPerf", [""], ["just"]), F("presCont", T.now, [""], "inf")] },
  { key: "spend", head: "spend", ing: "spending", past: "spent", pp: "spent", form: "ger", spend: true, tags: "ongoing",
    frames: [F("presSimple", T.habit), F("past", T.past), F("presCont", ["today", "this afternoon"]), F("presPerf", ["today"]), F("presPerf", [""], ["just"])] },

  // remember / forget + -ing: recalling something that already happened.
  // The past-time phrase ("as a child", "last summer") is what makes the gerund the only answer.
  { key: "remember (-ing)", head: "remember", form: "ger", tags: "memory", memoryVerb: true,
    frames: [F("presSimple", T.memory)] },
  { key: "forget (-ing)", head: "forget", form: "ger", tags: "memory", memoryVerb: true,
    frames: [F("willNever", T.memory)] }
];

// Set to false to drop the remember/forget + -ing questions entirely.
export const INCLUDE_MEMORY_GERUNDS = true;

const DURATIONS = ["an hour", "two hours", "all afternoon", "30 minutes", "a lot of time"];
const INDIRECT_OBJECTS = ["me", "him", "her", "us", "them"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function thirdPerson(word) {
  if (/(s|sh|ch|x|z|o)$/.test(word)) return word + "es";      // finish → finishes, go → goes
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  return word + "s";
}

export function verbPhrase(subject, verb, tense, adv = "") {
  if (verb.fixed) return verb.fixed;
  if (verb.be) {
    if (tense === "presSimple") return `${be(subject)} ${verb.be}`;
    if (tense === "past") return `${wasWere(subject)} ${verb.be}`;
    if (tense === "presPerf") return `${have(subject)}${adv ? " " + adv : ""} been ${verb.be}`;
  }
  const tail = verb.particle ? ` ${verb.particle}` : "";
  const third = isThirdSingular(subject);
  if (verb.negative) {
    if (tense === "presSimple") return `${third ? "doesn't" : "don't"} ${verb.head}`;
    if (tense === "past") return `didn't ${verb.head}`;
  }
  const a = adv ? ` ${adv}` : "";
  switch (tense) {
    case "presSimple": return `${adv ? adv + " " : ""}${third ? thirdPerson(verb.head) : verb.head}${tail}`;
    case "past": return `${verb.past}${tail}`;
    case "presCont": return `${be(subject)} ${verb.ing}${tail}`;
    case "presPerf": return `${have(subject)}${a} ${verb.pp}${tail}`;
    case "willNever": return `will never ${verb.head}${tail}`;
  }
  throw new Error(`Unknown tense ${tense} for ${verb.key}`);
}

const HABITUAL_TIMES = new Set([...T.habit, ...T.likes]);

/** Activities that fit this verb (and, if given, this time phrase). */
export function activitiesFor(verb, time = "") {
  const allowed = verb.tags ? verb.tags.split(" ") : null;
  return ACTIVITIES.filter((a) =>
    (!allowed || a.tags.some((t) => allowed.includes(t))) &&
    !(HABITUAL_TIMES.has(time) && a.tags.includes("oneoff")));
}

/** Build one question from fully specified parts (used by the generator and the review dump). */
export function buildQuestion({ subject, verb, frame, time, adv, activity, io, duration }) {
  let before = `${subject.text} ${verbPhrase(subject, verb, frame.tense, adv)}`;
  if (verb.spend) before += ` ${duration}`;
  else if (io) before += ` ${io}`;
  const after = `${activity.rest ? " " + activity.rest : ""}${time ? " " + time : ""}.`;
  const form = frame.form || verb.form;
  const inf = `to ${activity.base}`;
  const answers = form === "inf" ? [inf] : form === "ger" ? [activity.ger] : [inf, activity.ger];
  const rule = verb.spend ? "spend + time + -ing"
    : io ? `${verb.key} + person + to …`
    : `${verb.key.replace(/ \((to|-ing)\)/, "")} + ${form === "inf" ? "to …" : form === "ger" ? "-ing" : "to … OR -ing"}`;
  return {
    before,
    hint: activity.base,
    after,
    answers,
    rule,
    full: `${before} ${answers[0]}${after}`,
    gap: `${before} _______ (${activity.base})${after}`
  };
}

const FILTERS = {
  all: () => true,
  inf: (v) => v.form === "inf",
  ger: (v) => v.form === "ger",
  both: (v) => v.form === "both",
  want: (v) => v.key === "want",
  spend: (v) => v.spend
};

// Recently used words: main verb, second verb and object are kept out of the next few questions.
const RECENT_LIMIT = 5;
const recent = [];
const mainWord = (v) => v.head || v.be || v.key;            // "remember (to)" and "remember (-ing)" count as one
const isFresh = (verb, activity) => !recent.some((r) =>
  r.main === mainWord(verb) || r.second === activity.base || (activity.rest && r.object === activity.rest));

export function generateQuestion(filter = "all") {
  const pool = VERBS.filter((v) => (INCLUDE_MEMORY_GERUNDS || !v.memoryVerb) && (FILTERS[filter] || FILTERS.all)(v));
  // Build every (verb, frame, time) option that still has a fresh activity; if the history
  // rules everything out (tiny filtered pools), fall back to ignoring it.
  const options = [];
  for (const verb of pool)
    for (const frame of verb.frames)
      for (const time of frame.times) {
        const acts = activitiesFor(verb, time).filter((a) => isFresh(verb, a));
        if (acts.length) options.push({ verb, frame, time, acts });
      }
  // Pick the verb first (uniformly), so verbs with many frames aren't favoured.
  let choice;
  if (options.length) {
    const verbs = [...new Set(options.map((o) => o.verb))];
    const verb = pick(verbs);
    choice = pick(options.filter((o) => o.verb === verb));
  } else {
    const verb = pick(pool), frame = pick(verb.frames), time = pick(frame.times);
    choice = { verb, frame, time, acts: activitiesFor(verb, time) };
  }
  const { verb, frame, time } = choice;
  const activity = pick(choice.acts);
  recent.push({ main: mainWord(verb), second: activity.base, object: activity.rest });
  if (recent.length > RECENT_LIMIT) recent.shift();

  const subject = pick(SUBJECTS);
  const selfObject = { I: "me", We: "us" }[subject.text];          // never "I want me to…"
  const io = verb.allowIO && Math.random() > 0.4
    ? pick(INDIRECT_OBJECTS.filter((o) => o !== selfObject)) : null;
  return buildQuestion({
    subject, verb, frame, io, time, activity,
    adv: pick(frame.adv),
    duration: pick(DURATIONS)
  });
}

export { SUBJECTS, ACTIVITIES };

export function normalize(text) {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

export function checkAnswer(question, input) {
  const given = normalize(input);
  return question.answers.some((a) => normalize(a) === given);
}
