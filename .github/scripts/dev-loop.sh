#!/usr/bin/env bash
# Jowork 自主开发循环 — 由 GitHub Actions 调用
# ⚠️ 不用 set -e：claude 到达 max-turns 返回非零，会提前杀死循环
set -uo pipefail

PLAN="docs/JOWORK-PLAN.md"
BASE_PROMPT=".github/prompts/jowork-autonomous.md"
MAX_ROUNDS=25
ROUND=0

pending() {
  python3 -c "print(open('${PLAN}').read().count('- [ ]'))"
}

done_count() {
  python3 -c "print(open('${PLAN}').read().count('- [x]'))"
}

first_task() {
  python3 - <<'EOF'
text = open('docs/JOWORK-PLAN.md').read()
lines = text.splitlines()
for i, line in enumerate(lines):
    if '- [ ]' in line:
        print(f"第 {i+1} 行: {line.strip()}")
        break
EOF
}

echo "=============================="
echo " Jowork 自主开发循环启动"
echo " 待完成: $(pending) | 已完成: $(done_count)"
echo "=============================="

while [ "$ROUND" -lt "$MAX_ROUNDS" ]; do
  P=$(pending)
  echo ""
  echo "=== Round ${ROUND} | Pending: ${P} | Done: $(done_count) ==="

  if [ "$P" -eq 0 ]; then
    echo "All tasks completed!"
    break
  fi

  TASK_INFO=$(first_task)
  echo "当前任务: ${TASK_INFO}"

  PROMPT_FILE="/tmp/jowork-prompt-${ROUND}.txt"
  cat "${BASE_PROMPT}" > "${PROMPT_FILE}"
  printf "\n\n== 本轮任务 Round %s ==\n%s\n\n立即开始：先把这个 [ ] 改为 [x]，再继续下一个。\n" \
    "${ROUND}" "${TASK_INFO}" >> "${PROMPT_FILE}"

  # ⚠️ || true 必须有：claude 到达 max-turns 返回非零，不能让它终止循环
  claude \
    --dangerously-skip-permissions \
    --max-turns 80 \
    -p "$(cat "${PROMPT_FILE}")" || true

  git add -A
  if ! git diff --cached --quiet; then
    DONE=$(done_count)
    git commit -m "feat(jowork): round=${ROUND} done=${DONE} [skip ci]"
    # ⚠️ || true：push 失败不终止循环，下轮还能继续
    git push origin main || echo "push 失败，继续下一轮"
    echo "Round ${ROUND} pushed, done=${DONE}"
  else
    echo "No changes in round ${ROUND}"
  fi

  ROUND=$((ROUND + 1))
done

echo ""
echo "结束 | 共 ${ROUND} 轮 | 已完成 $(done_count) 项"
