# ICM method notes (reference)

Load this to understand *why* the ICM structure is shaped this way, or before proposing changes to it.
Not needed for ordinary feature work. Written 2026-10-01 by Claude, in its own words.

Source: Jake Van Clief's video "You're Automating The Wrong Layer" (YouTube, published 2026-05-20, ~26 min),
read from YouTube's auto-generated captions. Companion material: his ICM paper (arXiv 2603.16021).
Everything below is his claim or my reading of it. None of it was measured in this repo.

## The argument in short

1. **Three layers of working with AI.** Chat and copy-paste (low effort, weak and uneven results) → saved
   prompts and skills (someone has already found the right prompts in the right order) → folders of markdown
   plus scripts that one agent navigates, loading only the part it needs when it needs it.
2. **Every workflow starts as a conversation.** The structure you want is already inside good dialogue:
   goals, sub-goals, constraints, assumptions, and the decisions made against them, on both the human side
   and the model side. Capture those in files and the next request can be one short sentence.
3. **Point, don't preload.** A root file says where things are (his example: a voice-and-tone file). The agent
   reads it when the task needs it. This replaces pasting context each session and avoids stuffing the
   context window.
4. **Determinism goes in scripts.** Anything that must come out the same every time is code, not a prompt.
5. **State lives in the folders, so a fresh session can resume.** Each stage writes files the next stage
   reads; a new conversation costs fewer tokens because nothing has to be re-injected.
6. **One good agent harness plus structure** beats building a multi-agent framework. Do not reinvent what
   the agent tool already provides.

His worked example is a content pipeline in one folder: research → scripts → audio → animation, each stage
reading the previous stage's files, with a human checking the output.

## Claims to treat as unverified

- 20–40% token reduction, 30,000 community members, and "$1.20 for an hour" for the voice-controlled demo are
  his figures. The demo (several people steering one local Claude Code agent by voice in a meeting) is a
  research direction, not something Clearview needs.
- The method is not claimed to be proven beyond the author's own and his community's use.

## How it maps to this repo

| Idea | Where it already lives |
|---|---|
| Root pointer file | `CLAUDE.md` (router, ≤80 lines) |
| Load only what the task needs | Load / Do not load tables in `CLAUDE.md` and `.ai/CONTEXT.md` |
| Stage files the next stage reads | `.ai/workflows/*/CONTEXT.md` Input → Process → Output → Completion |
| Determinism in code | `functions/_lib/*.mjs`, enforced by the tests in `npm run test:all` |
| Resume without conversation memory | `.ai/STATE.md`, `.ai/WORKING.md`, `HANDOFF.md` (the ICM walk test) |
| Human check at each boundary | Approval gates; `VERIFY` states |

## The one idea this repo does not do yet

**Capture the decision chain, not just the outcome.** `CHANGELOG.md` records what changed. It does not record
the goal, the constraints that were set along the way, and the assumptions made. When a session ends,
add those to the dated entry so the next agent does not rediscover them. Do this by hand first. A tool to
extract them automatically is worth building only after the manual habit proves useful (Cathedral order).
