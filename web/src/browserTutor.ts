// Conversation tutor on Chrome's built-in Prompt API (Gemini Nano, run on
// this device; ADR 0005). Free, no key, nothing leaves the machine.
// https://developer.chrome.com/docs/ai/prompt-api
//
// Rules from CLAUDE.md: the model's output is validated before it is shown
// (schema, length, script), and the model never grades the learner: it may
// suggest a better way to say something, and that's all.

type Availability = "unavailable" | "downloadable" | "downloading" | "available";
type Expected = { type: "text"; languages: string[] }[];
interface Options {
  expectedInputs?: Expected;
  expectedOutputs?: Expected;
}
interface Session extends EventTarget {
  prompt(input: string, o?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface LanguageModelStatic {
  availability(o?: Options): Promise<Availability>;
  create(
    o?: Options & {
      initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[];
      monitor?: (m: EventTarget) => void;
    },
  ): Promise<Session>;
}

const LM = (globalThis as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;
export const supported = !!LM;

// Sprout pack → what the model is told and which language tag it's declared
// with. `script` checks a reply is really in the language being learned.
interface Pack {
  tag: string;
  name: string;
  script: RegExp;
}
const PACKS: Record<string, Pack> = {
  "cmn-Hans": { tag: "zh", name: "Mandarin Chinese, written in Simplified characters", script: /\p{Script=Han}/u },
  "yue-Hant": { tag: "zh", name: "Cantonese, written in Traditional characters", script: /\p{Script=Han}/u },
  es: { tag: "es", name: "Spanish", script: /[a-záéíóúüñ¿¡]/iu },
};

export const tutorable = (pack: string) => !!PACKS[pack];

/**
 * How well this browser can tutor a pack. "official": Chrome supports the
 * language. "experimental": Chrome doesn't list it (Chinese, today), so the
 * session is declared as English and asked to answer in the target language
 * anyway; it may work, poorly or not at all. null: no tutor here.
 */
export type Mode = { kind: "official" | "experimental"; state: Availability; options: Options };

export async function probe(pack: string): Promise<Mode | null> {
  const p = PACKS[pack];
  if (!LM || !p) return null;
  const declared = (langs: string[]): Options => ({
    expectedInputs: [{ type: "text", languages: langs }],
    expectedOutputs: [{ type: "text", languages: langs }],
  });
  const tries: [Mode["kind"], Options][] = [
    ["official", declared([p.tag, "en"])],
    ["experimental", declared(["en"])],
  ];
  for (const [kind, options] of tries) {
    const state = await LM.availability(options).catch(() => "unavailable" as const);
    if (state !== "unavailable") return { kind, state, options };
  }
  return null;
}

export const SCENARIOS = [
  { id: "chat", label: "Small talk", prompt: "casual small talk getting to know each other (name, work, hobbies)" },
  { id: "cafe", label: "Ordering at a café", prompt: "you are a café server and the learner is ordering a drink and a snack" },
  { id: "directions", label: "Asking directions", prompt: "the learner is lost in a city and asks you, a passer-by, for directions" },
  { id: "shopping", label: "Shopping", prompt: "you are a shopkeeper at a market; the learner is buying fruit and asks about prices" },
  { id: "weekend", label: "Weekend plans", prompt: "you and the learner are friends making plans for the weekend" },
] as const;

export const LEVELS = [
  { id: "beginner", label: "Beginner", prompt: "a beginner (about HSK 1–2 / A1–A2): very short sentences, only the most common words" },
  { id: "intermediate", label: "Intermediate", prompt: "an intermediate learner (about HSK 3–4 / B1): short, natural sentences" },
] as const;

/** One validated tutor turn. `suggested` is empty when there's nothing to suggest. */
export interface Reply {
  reply: string;
  english: string;
  suggested: string;
  why: string;
}

// Constrained decoding: the model can only produce this shape.
const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    english: { type: "string" },
    suggested: { type: "string" },
    why: { type: "string" },
  },
  required: ["reply", "english", "suggested", "why"],
  additionalProperties: false,
};

const MAX = { reply: 300, english: 500, suggested: 200, why: 300 };
const norm = (s: string) => s.replace(/[\s\p{P}]/gu, "").toLowerCase();

/**
 * Parse and check a raw model answer. Throws on anything unusable; drops a
 * "suggestion" that is empty, identical to what the learner wrote, or not in
 * the target language. Pure, so it's tested without a model.
 */
export function validate(raw: string, pack: string, learner: string | null): Reply {
  const p = PACKS[pack];
  if (!p) throw new Error("no tutor for this language");
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    throw new Error("the tutor's answer wasn't valid JSON");
  }
  const get = (k: keyof Reply) => {
    const v = (o as Record<string, unknown>)?.[k];
    return typeof v === "string" ? v.trim().slice(0, MAX[k]) : "";
  };
  const r: Reply = { reply: get("reply"), english: get("english"), suggested: get("suggested"), why: get("why") };
  if (!r.reply) throw new Error("the tutor's answer was empty");
  if (!p.script.test(r.reply)) throw new Error(`the tutor answered in the wrong language`);
  const keep = learner !== null && !!r.suggested && p.script.test(r.suggested) && norm(r.suggested) !== norm(learner);
  if (!keep) {
    r.suggested = "";
    r.why = "";
  }
  return r;
}

function systemPrompt(pack: string, scenario: string, level: string, words: string[]): string {
  const p = PACKS[pack];
  const sc = SCENARIOS.find((s) => s.id === scenario) ?? SCENARIOS[0];
  const lv = LEVELS.find((l) => l.id === level) ?? LEVELS[0];
  return [
    `You are a friendly conversation partner helping someone practise ${p.name}.`,
    `The learner is ${lv.prompt}.`,
    `Role-play: ${sc.prompt}. Stay in the role.`,
    `Always answer with a JSON object:`,
    `- "reply": your next line, in ${p.name} only. One or two short sentences. End with a question when it fits, to keep the conversation going.`,
    `- "english": an English translation of your reply.`,
    `- "suggested": if the learner's last message has a mistake or sounds unnatural in ${p.name}, a corrected, natural version of their whole message. Otherwise "".`,
    `- "why": one short English sentence explaining the suggestion, or "".`,
    `Never give scores, grades or praise ratings. If the learner writes in English, answer in ${p.name} and put how to say their message in ${p.name} in "suggested".`,
    words.length ? `When natural, reuse words the learner is studying: ${words.slice(0, 40).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface Tutor {
  /** Send the learner's message (null = let the tutor open the conversation). */
  ask(text: string | null): Promise<Reply>;
  destroy(): void;
  /** Set when older turns were dropped to fit the model's context window. */
  onOverflow(f: () => void): void;
}

/**
 * Start a session. Call it straight from a click: creating the session may
 * download the model, which Chrome allows only after a user gesture.
 */
export async function start(
  pack: string,
  mode: Mode,
  scenario: string,
  level: string,
  words: string[],
  onProgress?: (p: number) => void,
): Promise<Tutor> {
  if (!LM) throw new Error("This browser has no built-in AI model.");
  const session = await LM.create({
    ...mode.options,
    initialPrompts: [{ role: "system", content: systemPrompt(pack, scenario, level, words) }],
    monitor: (m) => m.addEventListener("downloadprogress", (e) => onProgress?.((e as ProgressEvent).loaded)),
  });
  return {
    async ask(text) {
      const input = text ?? "Start the conversation: greet me and open the role-play with one short line.";
      let last: unknown;
      // One retry: a small on-device model occasionally drifts out of language.
      for (let i = 0; i < 2; i++) {
        try {
          const raw = await session.prompt(input, { responseConstraint: SCHEMA });
          return validate(raw, pack, text);
        } catch (e) {
          if (e instanceof DOMException && e.name === "QuotaExceededError") throw new Error("That message is too long for the on-device model.");
          last = e;
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
    destroy: () => session.destroy(),
    onOverflow: (f) => session.addEventListener("contextoverflow", f),
  };
}
