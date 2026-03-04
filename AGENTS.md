# AGENTS.md — Multi-AI Collaboration Rules

> Every AI instance working on this repo MUST read this file before starting any work.
> These rules prevent conflicts when multiple Claude instances work in parallel.

## 0. Golden Rule

**One task at a time.** Check what's in progress before starting anything new.

## 1. Before You Start

```bash
# 1. See what's changed recently
git log --oneline -10

# 2. Check if anyone else is working on your target file
git log --oneline -5 -- <file-you-want-to-change>

# 3. Pull latest
git pull --rebase origin main

# 4. Read Section 0.7 of docs/JOWORK-PLAN.md to see phase status
```

## 2. Task Claiming

Tasks are tracked in `docs/JOWORK-PLAN.md` Section 0.7 and in the Appendix A checklist.

**Before starting a task:**
1. Find a task marked `⏳ 未开始` or `[ ]` (unchecked)
2. Change it to `🔄 进行中` and commit immediately:
   ```bash
   git commit -m "chore: claim task — [task name]"
   git push
   ```
3. Now it's yours. Other AI instances will skip it.

**After finishing:**
1. Change to `✅ 完成`
2. Commit with meaningful message
3. Push

## 3. Conflict Rules

- **Never rebase shared history** (no `git push --force`)
- **Never amend pushed commits**
- If git pull finds conflicts: resolve, commit merge, push
- If you can't resolve a conflict: leave it and report in commit message

## 4. Scope Limits Per Session

- Max 1-2 related tasks per session
- Don't refactor things outside your task scope
- Don't add features beyond what's in JOWORK-PLAN.md

## 5. Test Gate (Mandatory)

Before every commit:
```bash
pnpm lint    # must pass
pnpm test    # must pass (or explain why failure is pre-existing)
```

If tests fail and you can't fix them in 2 attempts: commit what works,
mark task as `⚠️ 测试待修` and move on.

## 6. File Ownership (avoid simultaneous edits)

| File | Priority owner |
|------|---------------|
| `docs/JOWORK-PLAN.md` | Current task claimer |
| `packages/core/src/db.ts` | Phase 0-1 AI |
| `packages/core/src/agent/` | Phase 1-3 AI |
| `apps/jowork/src-tauri/` | Phase 3-4 AI |

## 7. Communication via Commits

Since multiple AI instances can't talk directly, use commits as messages:

```bash
# Leaving a note for the next AI
git commit -m "feat: implement X

Note for next AI: Y still needs doing, I left a TODO at src/foo.ts:42
Blocker: need decision on Z before implementing W"
```
