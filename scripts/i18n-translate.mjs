// Draft translations for missing or stale catalog entries with Claude.
//
//   pnpm i18n:translate zh-Hans --only menu,tasks.taskcontextmenu --limit 300
//   pnpm i18n:translate zh-Hans --dry-run
//   pnpm i18n:translate zh-Hans --only menu.dailyDesk --force   # after a glossary fix
//
// Only product strings and their translator descriptions are sent: never
// workspace content, paths or user data. Output is validated with the same
// rules as `pnpm i18n:check` before it is written; anything that fails is
// retried once with the problem explained, then left untranslated and
// reported. Existing translations whose English hasn't changed are never
// touched, so hand edits survive every run.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOCALE_PATTERN, readLocale, writeLocale } from "./i18n-catalog.mjs";
import {
  pendingEntries,
  placeholders,
  readSource,
  translationProblem,
} from "./i18n.mjs";

const root = new URL("../", import.meta.url);
const DEFAULTS = {
  // The zh-Hans pilot (300 strings) passed review-level checks on Haiku for ~1¢.
  model: "claude-haiku-5-5",
  effort: "medium",
  batchSize: 60,
  concurrency: 4,
};

export function parseArgs(argv) {
  const options = { ...DEFAULTS, only: [], limit: Infinity, dryRun: false, force: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--only") options.only = value().split(",").map((p) => p.trim()).filter(Boolean);
    else if (arg === "--limit") options.limit = Number(value());
    else if (arg === "--batch-size") options.batchSize = Number(value());
    else if (arg === "--concurrency") options.concurrency = Number(value());
    else if (arg === "--model") options.model = value();
    else if (arg === "--effort") options.effort = value();
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else rest.push(arg);
  }
  options.locale = rest[0];
  if (!options.locale || options.locale === "en" || !LOCALE_PATTERN.test(options.locale))
    throw new Error("Usage: node scripts/i18n-translate.mjs <locale|all> [--only prefix,…] [--limit n] [--dry-run]");
  if (options.force && !options.only.length)
    throw new Error("--force re-translates current entries too; limit it with --only");
  for (const name of ["limit", "batchSize", "concurrency"])
    if (!(options[name] > 0)) throw new Error(`--${name} must be a positive number`);
  return options;
}

/** Keys grouped by surface (first two segments), then cut into batches. */
export function makeBatches(entries, size) {
  const groups = new Map();
  for (const entry of entries) {
    const surface = entry.key.split(".").slice(0, 2).join(".");
    if (!groups.has(surface)) groups.set(surface, []);
    groups.get(surface).push(entry);
  }
  const batches = [];
  let current = [];
  for (const group of groups.values()) {
    // Keep a surface together when it fits; split large ones on their own.
    if (current.length && current.length + group.length > size) {
      batches.push(current);
      current = [];
    }
    for (const entry of group) {
      current.push(entry);
      if (current.length === size) {
        batches.push(current);
        current = [];
      }
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

export function systemPrompt(glossary) {
  const terms = glossary.terms
    .map((t) => `- ${t.source} → ${t.target}${t.note ? ` (${t.note})` : ""}`)
    .join("\n");
  return `You translate the user interface of Octarine, a local-first desktop app for Markdown notes, tasks and an AI assistant, from English into ${glossary.language} (locale ${glossary.locale}).

Each request is a JSON list of catalog entries. For every entry return its key and a translation of "english". Use "description" (written for translators) to understand where the text appears and what placeholders mean. "previous" is an earlier translation of older English; keep its wording where the meaning hasn't changed.

Rules:
- Translate every entry, in the same order, and return each key exactly once.
- Placeholders are names in braces such as {count} or {title}. Every translation must contain exactly the placeholders of its English text, unchanged, and no other braces. Move them wherever Chinese word order needs.
- When an entry has "plural": true, return "plural" with the forms listed in "pluralForms" and leave "text" null. Otherwise return "text" and leave "plural" null.
- Return only the UI text itself: no quotes around it, no notes, no alternatives.
- Entries with "searchKeywords": true are search terms people type to find a command or setting; they are never displayed. Return comma-separated ${glossary.language} terms people would actually type, including common synonyms. Do not repeat the English: it stays searchable automatically.
- Never translate these names: ${glossary.keep.join(", ")}.

Style:
${glossary.style.map((line) => `- ${line}`).join("\n")}

Terminology (use these consistently):
${terms}`;
}

const pluralForms = (locale) =>
  new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

export function requestEntries(locale, batch, translated, feedback = {}) {
  return batch.map((entry) => {
    const plural = typeof entry.message !== "string";
    return {
      key: entry.key,
      english: entry.message,
      description: entry.description,
      ...(placeholders(entry.message).length && { placeholders: placeholders(entry.message) }),
      ...(plural && { plural: true, pluralForms: pluralForms(locale) }),
      ...(entry.kind === "keywords" && { searchKeywords: true }),
      ...(translated[entry.key] && { previous: translated[entry.key].message }),
      ...(feedback[entry.key] && { problemWithLastAttempt: feedback[entry.key] }),
    };
  });
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          text: nullableString,
          plural: {
            anyOf: [
              {
                type: "object",
                properties: {
                  zero: nullableString,
                  one: nullableString,
                  two: nullableString,
                  few: nullableString,
                  many: nullableString,
                  other: { type: "string" },
                },
                required: ["zero", "one", "two", "few", "many", "other"],
                additionalProperties: false,
              },
              { type: "null" },
            ],
          },
        },
        required: ["key", "text", "plural"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
};

/** Turn the model's rows into catalog messages, keeping only valid ones. */
export function acceptTranslations(locale, batch, rows) {
  const byKey = new Map(batch.map((entry) => [entry.key, entry]));
  const accepted = {};
  const problems = {};
  for (const row of rows ?? []) {
    const entry = byKey.get(row?.key);
    if (!entry || accepted[row.key]) continue;
    let message;
    if (typeof entry.message === "string") message = row.text;
    else if (row.plural) {
      // Keep the forms this language uses; the schema makes the rest null.
      message = Object.fromEntries(
        pluralForms(locale)
          .filter((form) => typeof row.plural[form] === "string")
          .map((form) => [form, row.plural[form]])
      );
    }
    const problem =
      message == null
        ? typeof entry.message === "string"
          ? "missing text"
          : "missing plural forms"
        : translationProblem(locale, entry, message);
    if (problem) problems[row.key] = problem;
    else {
      accepted[row.key] = message;
      delete problems[row.key];
    }
  }
  for (const entry of batch)
    if (!accepted[entry.key] && !problems[entry.key]) problems[entry.key] = "not returned";
  return { accepted, problems };
}

export const supportsFallback = (model) =>
  /^claude-(opus-5|sonnet-5-5|fable-5-[12])/.test(model);

async function callModel(client, options, system, entries) {
  const stream = client.beta.messages.stream({
    model: options.model,
    max_tokens: 64000,
    // Server-side refusal fallback exists only for some models (not Haiku).
    ...(supportsFallback(options.model) && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    }),
    output_config: {
      effort: options.effort,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    // The system prompt and glossary are identical for every batch.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(entries, null, 1) }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal")
    return { kind: "refused", detail: response.stop_details?.category ?? "unknown" };
  if (response.stop_reason === "max_tokens") return { kind: "truncated" };
  const text = response.content.find((block) => block.type === "text")?.text;
  try {
    return { kind: "ok", rows: JSON.parse(text).translations, usage: response.usage };
  } catch {
    return { kind: "unparseable" };
  }
}

/** One batch: call, validate, retry failures once with feedback, split on truncation. */
export async function translateBatch(client, options, system, batch, translated, log) {
  const accepted = {};
  let remaining = batch;
  let feedback = {};
  for (let attempt = 0; attempt < 2 && remaining.length; attempt++) {
    const result = await callModel(
      client,
      options,
      system,
      requestEntries(options.locale, remaining, translated, feedback)
    );
    if (result.kind === "truncated" && remaining.length > 1) {
      const half = Math.ceil(remaining.length / 2);
      const parts = [remaining.slice(0, half), remaining.slice(half)];
      for (const part of parts)
        Object.assign(accepted, await translateBatch(client, options, system, part, translated, log));
      return accepted;
    }
    if (result.kind !== "ok") {
      feedback = Object.fromEntries(remaining.map((e) => [e.key, `whole batch failed: ${result.kind}`]));
      log.warn(`  batch ${remaining[0].key}…: ${result.kind}${result.detail ? ` (${result.detail})` : ""}`);
      continue;
    }
    log.usage(result.usage);
    const outcome = acceptTranslations(options.locale, remaining, result.rows);
    Object.assign(accepted, outcome.accepted);
    feedback = outcome.problems;
    remaining = remaining.filter((entry) => !accepted[entry.key]);
  }
  for (const entry of remaining) log.failed(entry.key, feedback[entry.key] ?? "failed");
  return accepted;
}

export const isTransient = (error) =>
  error?.status === 429 ||
  error?.status >= 500 ||
  /Connection|Timeout/.test(error?.constructor?.name ?? "");

const gitCommit = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

export async function run(argv, { client: injectedClient, log = console } = {}) {
  const options = parseArgs(argv);
  const glossaryUrl = new URL(`src/i18n/glossary/${options.locale}.json`, root);
  let glossaryText;
  try {
    glossaryText = await readFile(glossaryUrl, "utf8");
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(`No glossary at src/i18n/glossary/${options.locale}.json. Write one before translating.`);
    throw error;
  }
  const glossary = JSON.parse(glossaryText);
  const source = await readSource();
  const translated = await readLocale(root, options.locale, { missingOk: true });
  const matches = (key) =>
    !options.only.length || options.only.some((prefix) => key.startsWith(prefix));
  // --force also redoes current entries, e.g. after a glossary change.
  const pending = pendingEntries(source, options.force ? {} : translated)
    .filter((entry) => matches(entry.key))
    .slice(0, options.limit);
  const batches = makeBatches(pending, options.batchSize);
  const system = systemPrompt(glossary);

  log.log(
    `${options.locale}: ${pending.length} pending entries in ${batches.length} batches (${options.model}, effort ${options.effort})`
  );
  if (options.dryRun) {
    if (batches.length)
      log.log(`\n--- system ---\n${system}\n\n--- first batch ---\n${JSON.stringify(requestEntries(options.locale, batches[0], translated), null, 1)}`);
    return { translated: 0, failed: [] };
  }
  if (!pending.length) return { translated: 0, failed: [] };

  let client = injectedClient;
  if (!client) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic();
  }

  const failed = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  const batchLog = {
    warn: (message) => log.warn(message),
    failed: (key, why) => failed.push({ key, why }),
    usage: (u) => {
      if (!u) return;
      for (const name of Object.keys(usage)) usage[name] += u[name] ?? 0;
    },
  };

  // Writes are serialized; each finished batch lands on disk so an
  // interrupted run keeps its progress.
  let writing = Promise.resolve();
  let done = 0;
  let count = 0;
  const hashes = new Map(pending.map((entry) => [entry.key, entry.sourceHash]));
  const persist = (accepted) => {
    if (!Object.keys(accepted).length) return writing;
    for (const [key, message] of Object.entries(accepted))
      translated[key] = { message, sourceHash: hashes.get(key) };
    count += Object.keys(accepted).length;
    writing = writing.then(() => writeLocale(root, options.locale, translated));
    return writing;
  };

  const queue = [...batches];
  const worker = async () => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      let accepted = {};
      try {
        accepted = await translateBatch(client, options, system, batch, translated, batchLog);
      } catch (error) {
        // Only rate limits, server errors and dropped connections are worth
        // moving past; anything else (no credentials, a bad request) would
        // fail every batch the same way, so stop.
        if (!isTransient(error)) {
          queue.length = 0;
          throw error;
        }
        // The SDK already retried this; give up on this batch only.
        for (const entry of batch) batchLog.failed(entry.key, `request failed: ${error?.message ?? error}`);
      }
      await persist(accepted);
      done++;
      log.log(`  ${done}/${batches.length} batches · ${count} translated · ${failed.length} failed`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, batches.length) }, worker));
  await writing;

  // Provenance stays beside the catalog, never inside shipped messages.
  const provenanceUrl = new URL(`src/i18n/provenance/${options.locale}.json`, root);
  let runs = [];
  try {
    runs = JSON.parse(await readFile(provenanceUrl, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  runs.push({
    at: new Date().toISOString(),
    model: options.model,
    effort: options.effort,
    sourceCommit: gitCommit(),
    glossarySha256: createHash("sha256").update(glossaryText).digest("hex"),
    only: options.only.length ? options.only : undefined,
    translated: count,
    failed: failed.length,
    usage,
  });
  await mkdir(new URL("./", provenanceUrl), { recursive: true });
  await writeFile(provenanceUrl, JSON.stringify(runs, null, 2) + "\n");

  for (const { key, why } of failed) log.warn(`  ✗ ${key}: ${why}`);
  log.log(
    `Translated ${count}, failed ${failed.length}. Tokens: ${usage.input_tokens} in (${usage.cache_read_input_tokens} cached), ${usage.output_tokens} out.`
  );
  return { translated: count, failed };
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const [target, ...flags] = process.argv.slice(2);
  // `all`: every locale with a glossary, one after another, so a failure in
  // one language still leaves the others drafted.
  const locales =
    target === "all"
      ? (await readdir(new URL("src/i18n/glossary/", root)))
          .filter((name) => name.endsWith(".json"))
          .map((name) => name.slice(0, -5))
          .sort()
      : [target];
  for (const locale of locales) {
    try {
      const { failed } = await run([locale, ...flags]);
      if (failed.length) process.exitCode = 1;
    } catch (error) {
      console.error(`${locale}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
