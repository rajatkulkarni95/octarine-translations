# Octarine translations

The interface text of [Octarine](https://octarine.app) in every language it ships, and the place to fix or add a translation.

Claude drafts each language from the English source, and the people who use Octarine in that language review it. A translation a person wrote or corrected is never overwritten by a later draft.

**To fix a translation, add a missing one or review a language, read [TRANSLATING.md](TRANSLATING.md).** If you don't use Git, [open an issue](../../issues/new/choose) instead.

## Languages

| Language | Code | Status | Reviewers |
| --- | --- | --- | --- |
| Chinese (Simplified) | `zh-Hans` | Pilot | Wanted |
| French | `fr` | Pilot | Wanted |
| German | `de` | Pilot | Wanted |
| Japanese | `ja` | Pilot | Wanted |

**Pilot** languages have a complete draft that a fluent speaker hasn't reviewed yet. A language becomes **Active** once it has a reviewer. From then on, new English text is drafted automatically and the reviewer checks it before it ships.

## Layout

- `src/i18n/locales/en/`: the English source, synced from the app. Don't edit it here.
- `src/i18n/locales/<code>/`: translations, one file per area of the app (`tasks.json`, `editor.json`, …).
- `src/i18n/glossary/<code>.json`: each language's style rules, fixed terms, names that stay in English, and its reviewers.
- `src/i18n/provenance/`: a log of each Claude drafting run. It doesn't ship in the app.
- `scripts/`: validation and drafting, synced from the app.
