---
name: obsidian-plugin-release-notes
description: Ensure Synch Obsidian plugin release notes are checked and updated before committing directly to main, creating a release-related commit, creating a branch for a pull request, or opening/updating a pull request that includes changes under apps/obsidian-plugin, root Obsidian release metadata, or the Obsidian plugin release workflow.
---

# Obsidian Plugin Release Notes

## Overview

Use this skill in the Synch repository before publishing git work that may affect the Obsidian plugin release. The goal is to keep `apps/obsidian-plugin/release-notes/next.md` accurate before commits land on `main` or a PR is opened.

## Workflow

1. Determine whether the pending work affects the Obsidian plugin:
   - Check `git status --short`.
   - Check staged/uncommitted changes with `git diff --name-only` and `git diff --cached --name-only`.
   - When preparing a PR, also compare against the base branch with `git diff --name-only origin/main...HEAD` when available.
   - Treat these paths as plugin-release relevant: `apps/obsidian-plugin/**`, root `manifest.json`, root `versions.json`, and `.github/workflows/release-obsidian-plugin.yml`.

2. If no plugin-release relevant files changed, state that release notes are not required and continue the requested git or PR task.

3. If plugin-release relevant files changed, inspect `apps/obsidian-plugin/release-notes/next.md` before committing or opening the PR.
   - If the file does not exist, create it using the current repository release-note format.
   - If it contains only a placeholder or does not mention the current plugin-facing changes, update it.
   - Preserve existing human-written entries and append or refine instead of replacing them wholesale.

4. When writing missing notes, summarize user-facing changes only.
   - Prefer headings such as `## Added`, `## Changed`, and `## Fixed`.
   - Mention Obsidian-visible behavior, release workflow changes, and vault safety fixes.
   - Avoid internal implementation details, test-only changes, and noisy file-by-file descriptions.
   - Preserve end-to-end encryption guarantees: do not imply that plaintext vault contents, keys, or decrypted data are uploaded or exposed.

5. Use the latest release as the historical baseline when the note needs a full refresh.
   - Prefer the latest GitHub release or latest tag if already known locally.
   - If uncertain, fetch tags or query GitHub before claiming what is latest.
   - Compare plugin paths from the latest release to `HEAD` and condense the result into release-note bullets.

6. Include the release notes file in the commit or PR when it was changed.
   - Before `git commit` on `main`, make sure `apps/obsidian-plugin/release-notes/next.md` is staged if relevant.
   - Before creating or updating a PR, make sure the PR diff includes the release-note update or explicitly explain why no note is needed.

## Current Release-Note Format

Use this shape for `apps/obsidian-plugin/release-notes/next.md`:

```markdown
# Next Obsidian plugin release

## Added

- ...

## Changed

- ...

## Fixed

- ...
```

Omit empty sections only when the existing file already uses a simpler structure. Keep bullets concise and written for plugin users.
