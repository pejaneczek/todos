---
name: ba-create-task
description: Business-analyst step. Turn a free-text feature description into a structured Taskly task (user story, Given/When/Then acceptance criteria, backend/frontend scope) saved under tasks/ and, when gh is authenticated, as a GitHub issue.
argument-hint: "\"<feature description>\""
disable-model-invocation: true
---

Input: `$ARGUMENTS` is the feature description. If it is empty, ask for one and stop.

1. Ground the task in the code. Read `backend/openapi.json`, `backend/prisma/schema.prisma`, `backend/src/features/todos/*`, `frontend/src/features/todos/{types.ts,api/todos.ts,TodosPage.tsx}`, and anything the description names. Note what already exists. If the feature already exists, say so and stop.
2. If the description is ambiguous in a way that changes the API or UX, ask at most 3 focused questions in one message. Otherwise record assumptions.
3. Pick the next number: the highest `tasks/TASK-*.md` + 1 (start at 001), zero-padded. Slug: kebab-case, at most 5 words.
4. Fill `.claude/skills/ba-create-task/template.md` into `tasks/TASK-NNN-<slug>.md`. Acceptance criteria must be numbered, testable, and observable (status codes, response fields, visible text). Include error and edge cases.
5. If `gh auth status` succeeds, show the title and ask "Create GitHub issue? (y/n)". On yes, run `gh label create task --color 0E8A16 --force`. Write the file body without its front matter (everything after the closing `---`) to a temp file outside the repo: `BODY="$(mktemp -d)/issue-body.md"`, then `gh issue create --title "TASK-NNN: <title>" --label task --body-file "$BODY"`. Then write the issue number into the front matter of `tasks/TASK-NNN-<slug>.md` (`issue: <n>`).
6. Do not commit. Say: "the task file will be committed together with the implementation by /dev-implement". Print the file path, the issue URL (if any), and the acceptance-criteria list.
