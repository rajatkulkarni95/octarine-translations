# Translating Octarine

Claude drafts every language from English. You make it read like software made by someone who speaks your language. Whatever you write wins: a later draft never replaces a translation a person edited.

You can help in three ways:

- **Fix or fill in a translation:** edit a file and open a pull request, or [open an issue](../../issues/new/choose) if you'd rather not use Git.
- **Review a language:** you're mentioned on every pull request that changes it, and you check the wording.
- **Ask for a new language:** open an issue. A maintainer writes its glossary and drafts the whole language, and you review the draft.

## Find the text

Every piece of text has an ID that says roughly where it appears, for example `tasks.taskdetails.leaveAComment`. The ID's first part names the file:

- English: `src/i18n/locales/en/tasks.json`
- German: `src/i18n/locales/de/tasks.json`

Search the English folder for the words you see in the app, then open the same ID in your language's file. On GitHub, press `t` to find a file, or use the repository search.

Each English entry has a `description` saying where the text appears and what any placeholders mean. Read it before you translate.

## Edit a translation

Change `message` and nothing else:

```json
"tasks.taskdetails.leaveAComment": {
  "message": "Kommentar schreiben…",
  "sourceHash": "64b1…"
}
```

`sourceHash` records which English text the translation was written against. You don't have to touch it: when you open a pull request, a check fills it in for every entry you changed.

To add a missing translation, add the entry with only a `message`. The check adds the hash. Keep the file in alphabetical order by ID if you can; if you don't, the check will point it out.

GitHub's web editor is fine for all of this: open the file, click the pencil, and GitHub creates the fork and pull request for you.

## Rules

**Placeholders.** Words in braces, such as `{title}`, `{count}` or `{date}`, are filled in by the app. Copy them exactly, don't translate the word inside, and move them wherever your grammar needs them. Some placeholders stand for a piece of the interface rather than text. For example, `{span}` in `"Properties{span}"` is the property count. Place those where they'd naturally go too.

**Plurals.** A message with a count is an object with one form per plural category:

```json
"message": { "one": "{count} Notiz", "other": "{count} Notizen" }
```

Use the categories your language has, not the ones English has. Japanese and Chinese use only `other`. Russian needs `one`, `few`, `many` and `other`. The check tells you if a category is missing, and the [CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) list them for every language.

**Search keywords.** An English entry marked `"kind": "keywords"` isn't displayed. It's a comma-separated list of words people type to find a command. Give the words a speaker of your language would type, with common synonyms. English stays searchable on its own.

**Names and symbols.** Product and brand names stay in English: Octarine, Octarine Pro, Ask Octarine, Markdown, Git, and the rest of the `keep` list in your language's glossary. Keep keyboard symbols (⌘ ⌥ ⇧ ↵), key names (Esc, Tab, Enter) and shortcut letters exactly as they are.

**Tone.** Follow the `style` rules in `src/i18n/glossary/<code>.json`, and the fixed terms in its `terms`, so that a task is always called the same thing everywhere. If a rule or term is wrong, change it in a pull request. Glossary changes apply to every later draft, so they're worth discussing in the pull request.

**English.** English is the source and is synced from the app, so the check rejects edits to it here. If the English itself is unclear or wrong, open an issue.

## Review a language

Reviewers are listed in the language's glossary:

```json
"reviewers": ["your-github-login"]
```

To volunteer, open a pull request adding your login, or open an issue. Reviewers:

- get mentioned on pull requests that change their language, including the automatic **Update translations** pull request where Claude's drafts arrive;
- read those changes and approve them, comment, or push fixes. You don't need write access; a maintainer merges;
- keep the glossary's style rules and terms current.

Once a language has a reviewer and they're happy with the draft, its glossary's `status` changes from `pilot` to `active`. From then on, new English text is drafted for it automatically.

## Checks

Every pull request runs `node scripts/i18n.mjs check`. It rejects:

- placeholders that don't match the English;
- missing plural categories;
- IDs that don't exist in English;
- files out of order.

An outdated translation (one whose English changed since) doesn't fail the check. The app keeps showing it while it still fits the new English, and the next draft updates it unless a person already has.

To run the checks yourself you need Node.js 20 or later. Nothing to install:

```sh
node scripts/i18n.mjs check
node scripts/i18n.mjs pending de   # entries in German that are missing or outdated
```

If your pull request comes from a fork, the check can't push the hashes to your branch, so it fails and asks for them. A maintainer will push the fix, or you can run this from your fork:

```sh
git remote add upstream https://github.com/<this repository>.git   # once
git fetch upstream
node scripts/i18n.mjs stamp --base upstream/main
node scripts/i18n.mjs format
git commit -am "Stamp edited translations" && git push
```

## How a translation reaches the app

1. English changes in the app and is synced here.
2. Claude drafts the new text for each active language and opens **Update translations**.
3. Reviewers check it, and fixes from anyone arrive as pull requests.
4. The app imports this repository's translations before each release. Missing or broken entries fall back to English, so a gap never breaks the app.
