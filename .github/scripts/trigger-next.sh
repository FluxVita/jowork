#!/usr/bin/env bash
# 检测是否还有待完成任务，有则立即触发下一轮 workflow
# 需要 permissions: actions: write + GH_TOKEN 环境变量
set -uo pipefail

PLAN="docs/JOWORK-PLAN.md"

if [ ! -f "$PLAN" ]; then
  echo "PLAN 文件不存在，跳过触发"
  exit 0
fi

PENDING=$(python3 -c "print(open('${PLAN}').read().count('- [ ]'))")
DONE=$(python3 -c "print(open('${PLAN}').read().count('- [x]'))")

echo "当前状态: 待完成=${PENDING} | 已完成=${DONE}"

if [ "$PENDING" -gt 0 ]; then
  echo "还有 ${PENDING} 个任务，触发下一轮..."
  gh workflow run jowork-autonomous.yml \
    --repo FluxVita/jowork \
    --ref main || echo "触发失败，等待下次 cron 调度"
  echo "已触发下一轮 workflow"
else
  echo "所有任务已完成，无需继续触发（等待新任务加入 PLAN.md）"
fi
