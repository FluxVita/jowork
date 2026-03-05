#!/usr/bin/env bash
# Jowork 自主开发循环 — 由 GitHub Actions 调用
set -euo pipefail

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
import re
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
  echo "=== Round ${ROUND} | Pending: ${P} ==="

  if [ "$P" -eq 0 ]; then
    echo "All tasks completed!"
    break
  fi

  TASK_INFO=$(first_task)
  echo "当前任务: ${TASK_INFO}"

  # 把任务信息追加到 prompt 临时文件，避免在 YAML 里拼接字符串
  PROMPT_FILE="/tmp/jowork-prompt-${ROUND}.txt"
  cat "${BASE_PROMPT}" > "${PROMPT_FILE}"
  printf "\n\n== 本轮任务（Round %s）==\n%s\n\n立即开始：先编辑 %s 把这个 [ ] 改为 [x]，再继续下一个。\n" \
    "${ROUND}" "${TASK_INFO}" "${PLAN}" >> "${PROMPT_FILE}"

  claude \
    --dangerously-skip-permissions \
    --max-turns 80 \
    -p "$(cat "${PROMPT_FILE}")"

  git add -A
  if ! git diff --cached --quiet; then
    DONE=$(done_count)
    git commit -m "feat(jowork): round=${ROUND} done=${DONE} [skip ci]"
    git push origin main
    echo "Pushed round ${ROUND}, done=${DONE}"
  else
    echo "No changes in round ${ROUND}"
  fi

  ROUND=$((ROUND + 1))
done

echo ""
echo "结束 | 共 ${ROUND} 轮 | 已完成 $(done_count) 项"
