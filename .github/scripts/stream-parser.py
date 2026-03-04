#!/usr/bin/env python3
"""解析 claude --output-format stream-json 的输出，实时打印关键信息"""
import sys
import json

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
        t = d.get('type', '')
        if t == 'assistant':
            for block in d.get('message', {}).get('content', []):
                if block.get('type') == 'text' and block.get('text'):
                    print(block['text'][:300], flush=True)
                elif block.get('type') == 'tool_use':
                    name = block.get('name', '?')
                    inp = str(block.get('input', ''))[:100]
                    print(f'[工具] {name}: {inp}', flush=True)
        elif t == 'tool_result':
            content = d.get('content', '')
            if isinstance(content, list):
                content = ' '.join(c.get('text', '') for c in content if c.get('type') == 'text')
            print(f'[结果] {str(content)[:200]}', flush=True)
        elif t == 'result':
            turns = d.get('num_turns', '?')
            print(f'[完成] turns={turns}', flush=True)
    except Exception:
        print(line[:200], flush=True)
