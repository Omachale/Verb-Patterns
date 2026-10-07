// Prints every pairing the generator can produce, for a human to skim:
//   Part A: each verb × tense × time phrase / adverb (with one sample activity)
//   Part B: each verb × every activity it allows (with one sample tense + time)
// Usage: node tools/dump-combos.mjs > review/combos.txt
import { VERBS, SUBJECTS, activitiesFor, buildQuestion } from "../src/verbs.js";

const she = SUBJECTS.find((s) => s.text === "She");
const we = SUBJECTS.find((s) => s.text === "We");
const out = [];
const line = (q) => out.push(`  ${q.full.padEnd(62)} → ${q.answers.join(" / ")}`);

out.push("PART A — tense & time phrase for each verb\n");
for (const verb of VERBS) {
  out.push(`■ ${verb.key}`);
  const sample = activitiesFor(verb)[0];
  for (const frame of verb.frames)
    for (const adv of frame.adv)
      for (const time of frame.times)
        for (const subject of [she, we])
          line(buildQuestion({ subject, verb, frame, time, adv, activity: sample, duration: "two hours", io: null }));
  out.push("");
}

out.push("\nPART B — every activity each verb accepts\n");
for (const verb of VERBS) {
  out.push(`■ ${verb.key}`);
  const frame = verb.frames[0];
  for (const activity of activitiesFor(verb, frame.times[0]))
    line(buildQuestion({ subject: she, verb, frame, time: frame.times[0], adv: frame.adv[0], activity, duration: "two hours", io: null }));
  out.push("");
}

console.log(out.join("\n"));
