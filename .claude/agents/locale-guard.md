---
name: locale-guard
description: Runs after any locale file is changed to verify all locale files remain in sync with en.json. Use this agent whenever you add, rename, or remove keys in any locales/*.json file.
---

After modifying any file in `locales/`, run the locale completeness test to catch missing or extra keys across all locale files:

```bash
npm test -- locales
```

If the test fails, the output will list which keys are missing or extra in which locale file. Fix all failures before proceeding. Rules:

1. `en.json` is the source of truth — add new keys there first.
2. Every other locale file (`de`, `es`, `fr`, `ja`, `ko`, `pt`, `zh`, `zh-TW`) must have the exact same set of keys as `en.json`.
3. Do not leave any locale with missing or extra keys — the test enforces this strictly.
