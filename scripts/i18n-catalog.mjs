// Shared reader/writer for the split locale catalogs.
//
// Source layout (committed):
//   src/i18n/locales/en/<namespace>.json        { key: { message, description } }
//   src/i18n/locales/<locale>/<namespace>.json  { key: { message, sourceHash } }
//
// A key lives in the file named after its first dot segment, and keys are kept
// sorted, so parallel branches adding copy touch different lines/files.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

export const SOURCE_LOCALE = "en";
export const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/;

export const namespaceOf = (key) => key.split(".")[0];

export const sourceHash = (entry) =>
  createHash("sha256")
    // `kind` is only present on keyword entries, so other fingerprints are unaffected.
    .update(
      JSON.stringify({
        message: entry.message,
        description: entry.description,
        kind: entry.kind,
      })
    )
    .digest("hex");

export const localesDir = (root) => new URL("src/i18n/locales/", root);
const localeDir = (root, locale) => new URL(`${locale}/`, localesDir(root));

export async function listLocales(root) {
  try {
    const entries = await readdir(localesDir(root), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && LOCALE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/** Every file that makes up a locale, for watchers and build invalidation. */
export async function localeFiles(root, locale) {
  try {
    return (await readdir(localeDir(root, locale)))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => new URL(name, localeDir(root, locale)));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Read one locale as a single key → entry map. Throws when a key sits in the
 * wrong namespace file or appears twice, so placement stays deterministic.
 */
export async function readLocale(root, locale, { missingOk = false } = {}) {
  const files = await localeFiles(root, locale);
  if (!files.length && !missingOk && locale === SOURCE_LOCALE)
    throw new Error(`No ${locale} catalog files in src/i18n/locales/${locale}/`);
  const catalog = {};
  for (const file of files) {
    const name = file.pathname.split("/").pop();
    const namespace = name.slice(0, -5);
    const entries = JSON.parse(await readFile(file, "utf8"));
    for (const [key, entry] of Object.entries(entries)) {
      if (namespaceOf(key) !== namespace)
        throw new Error(`${locale}/${name}: ${key} belongs in ${namespaceOf(key)}.json`);
      if (catalog[key]) throw new Error(`${locale}: duplicate message ${key}`);
      catalog[key] = entry;
    }
  }
  return catalog;
}

const serialize = (entries) =>
  JSON.stringify(
    Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]])),
    null,
    2
  ) + "\n";

/** Group a flat catalog by namespace into sorted file contents. */
export function splitCatalog(catalog) {
  const files = {};
  for (const [key, entry] of Object.entries(catalog)) {
    (files[namespaceOf(key)] ??= {})[key] = entry;
  }
  return Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((namespace) => [`${namespace}.json`, serialize(files[namespace])])
  );
}

/** Rewrite a locale directory in canonical (split, sorted) form. */
export async function writeLocale(root, locale, catalog) {
  const dir = localeDir(root, locale);
  await mkdir(dir, { recursive: true });
  const files = splitCatalog(catalog);
  for (const existing of await localeFiles(root, locale)) {
    if (!files[existing.pathname.split("/").pop()]) await rm(existing);
  }
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(new URL(name, dir), contents);
  }
}

/** Files whose on-disk text differs from canonical form. */
export async function unformattedFiles(root, locale) {
  const files = splitCatalog(await readLocale(root, locale, { missingOk: true }));
  const stale = [];
  for (const file of await localeFiles(root, locale)) {
    const name = file.pathname.split("/").pop();
    if ((await readFile(file, "utf8")) !== files[name]) stale.push(`${locale}/${name}`);
  }
  return stale;
}

/** Keys whose messages are search keywords (matched, never displayed). */
export const keywordKeys = (catalog) =>
  Object.keys(catalog)
    .filter((key) => catalog[key].kind === "keywords")
    .sort();

/** Runtime shape: key → message only. Descriptions and hashes never ship. */
export const compactCatalog = (catalog) =>
  Object.fromEntries(
    Object.keys(catalog)
      .sort()
      .map((key) => [key, catalog[key].message])
  );
