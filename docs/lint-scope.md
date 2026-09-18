# Lint scope for unused UI scaffold

`.oxlintrc.json` excludes two paths from linting:

- `components/ui/**`
- `hooks/use-mobile.ts`

Why: these files are the untouched shadcn/base-nova scaffold generated when the
project was created. Nothing in the active application imports them — the import
graph from `app/`, `src/`, and `lib/` contains no `@/components/ui` or
`hooks/use-mobile` reference. The only consumer is `components/ui/sidebar.tsx`
(itself scaffold), which imports the hook.

Because no active code depends on them, their accessibility/React-compiler
findings cannot affect the shipped app. Rather than blanket-disabling those
rules for real code, or deleting a large scaffold the team may still want, the
rules stay fully enabled everywhere else and the scaffold is simply not linted.

To re-enable linting for these files, remove the two `ignorePatterns` entries and
fix the resulting findings (or delete the unused scaffold entirely). Before
re-enabling, confirm the import graph: if a file is not reachable from
`src/main.tsx` / `app/`, it is not part of the active app.
