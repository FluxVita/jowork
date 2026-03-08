#!/bin/bash
# Jowork GitHub 仓库初始化脚本
# 前提：已在 GitHub 网页创建了 fluxvita 组织
# 运行：bash docs/github-setup.sh

set -e

echo "=== 创建 jowork 仓库 ==="
gh repo create fluxvita/jowork \
  --public \
  --description "Your AI coworker that actually knows your business. Open-source, self-hosted." \
  --homepage "https://jowork.work"

echo "=== 设置仓库 Topics ==="
gh repo edit fluxvita/jowork \
  --add-topic "ai" \
  --add-topic "agent" \
  --add-topic "self-hosted" \
  --add-topic "open-source" \
  --add-topic "typescript" \
  --add-topic "tauri" \
  --add-topic "llm" \
  --add-topic "knowledge-base" \
  --add-topic "productivity" \
  --add-topic "team-collaboration"

echo "=== 开启 Discussions ==="
gh repo edit fluxvita/jowork --enable-discussions

echo "=== 创建 Discussions 分类 ==="
# 通过 GraphQL 创建 Discussions 分类（gh 暂不直接支持，用 API）
# 先获取 repo node id
REPO_ID=$(gh api graphql -f query='{ repository(owner:"fluxvita",name:"jowork") { id } }' --jq '.data.repository.id')
echo "Repo ID: $REPO_ID"

echo "=== 推送初始代码（只推 README + 基础文件）==="
# 创建临时目录
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
git init
git checkout -b main

# 复制 README
cp /Users/signalz/Documents/augment-projects/fluxvita_allinone/docs/JOWORK-README.md README.md

# 创建 .gitignore
cat > .gitignore << 'EOF'
node_modules/
dist/
data/
*.db
*.db-shm
*.db-wal
.env
.env.local
target/
EOF

# 创建 LICENSE（AGPL-3.0）
cat > LICENSE << 'EOF'
                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007
...
(full AGPL-3.0 text - will be filled by the setup)
EOF

git add .
git commit -m "chore: initial commit — Jowork v0.1.0-alpha

Your AI coworker that actually knows your business.
Open-source, self-hosted AI agent platform."

git remote add origin https://github.com/fluxvita/jowork.git
git push -u origin main

cd -
rm -rf "$TMPDIR"

echo ""
echo "✅ 完成！访问 https://github.com/fluxvita/jowork"
