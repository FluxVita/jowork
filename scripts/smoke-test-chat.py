#!/usr/bin/env python3
"""
FluxVita Chat Smoke Test — 部署后自动验证
覆盖：Gateway 连通 → 认证 → Klaude 可用 → Builtin 对话 → Claude Agent 对话 → Session 连续性

用法：
  python3 scripts/smoke-test-chat.py                          # 默认 https://localhost:19800
  python3 scripts/smoke-test-chat.py https://jowork.work      # 指定 Gateway
  SMOKE_TIMEOUT=30 python3 scripts/smoke-test-chat.py         # 自定义超时

退出码：0=全通过  1=有失败  2=Gateway 不可达
"""

import json
import os
import time
import ssl
import sys
import urllib.request
import urllib.error

GATEWAY = sys.argv[1] if len(sys.argv) > 1 else "https://localhost:19800"
TIMEOUT = int(os.environ.get("SMOKE_TIMEOUT", "60"))

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def api(method, path, body=None, token=None, timeout=10):
    url = f"{GATEWAY}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    resp = urllib.request.urlopen(req, context=ctx, timeout=timeout)
    return json.loads(resp.read())


def sse_chat(message, engine, token, session_id=None, timeout=60):
    body = {"message": message, "engine": engine}
    if session_id:
        body["session_id"] = session_id
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    req = urllib.request.Request(f"{GATEWAY}/api/agent/chat", data=data, headers=headers, method="POST")
    resp = urllib.request.urlopen(req, context=ctx, timeout=timeout)

    event_name = ""
    final_text = ""
    session_out = None
    error_msg = None
    event_types = set()

    for raw in resp:
        line = raw.decode("utf-8", errors="replace").rstrip("\n\r")
        if line.startswith("event: "):
            event_name = line[7:].strip()
        elif line.startswith("data: ") and event_name:
            try:
                d = json.loads(line[6:])
            except json.JSONDecodeError:
                d = {}
            event_types.add(event_name)
            if event_name == "session_created":
                session_out = d.get("session_id")
            elif event_name == "text_done":
                final_text = d.get("content", "")
            elif event_name == "error":
                error_msg = d.get("message", str(d))
            elif event_name == "credits_exhausted":
                error_msg = "credits_exhausted"
            elif event_name == "done":
                break
            event_name = ""
        elif line == "":
            event_name = ""

    return {"text": final_text, "session_id": session_out, "error": error_msg, "events": event_types}


def test(name, fn):
    start = time.time()
    try:
        ok, detail = fn()
        elapsed = time.time() - start
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name} ({elapsed:.1f}s) {detail}")
        return ok
    except Exception as e:
        elapsed = time.time() - start
        print(f"  [FAIL] {name} ({elapsed:.1f}s) Exception: {e}")
        return False


def main():
    print(f"Smoke Test — {GATEWAY}")
    print(f"Time: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    # ── Pre-flight ──
    try:
        h = api("GET", "/health")
        print(f"Gateway: OK (uptime={h.get('uptime', '?'):.0f}s)")
    except Exception as e:
        print(f"Gateway UNREACHABLE: {e}")
        sys.exit(2)

    try:
        auth = api("POST", "/api/auth/local", {"username": "admin", "display_name": "Admin"})
        token = auth["token"]
        print(f"Auth: OK")
    except Exception as e:
        print(f"Auth FAILED: {e}")
        sys.exit(2)

    # ── Deep health check ──
    deep_ok = True
    try:
        deep = api("GET", "/health/deep", token=token, timeout=15)
        klaude = deep.get("klaude", {})
        credits = deep.get("credits", {})
        print(f"Klaude: {'OK' if klaude.get('ok') else 'DOWN — ' + klaude.get('error', '?')}")
        print(f"Credits: {credits.get('remaining', '?')} remaining (plan={credits.get('plan', '?')})")
        if not klaude.get("ok"):
            deep_ok = False
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print("Deep health: endpoint not available (old version)")
        else:
            print(f"Deep health: HTTP {e.code}")
    except Exception as e:
        print(f"Deep health: {e}")

    print()
    results = []
    session_builtin = None
    session_claude = None

    # ── Test 1: Builtin greeting ──
    def t1():
        r = sse_chat("你好，一句话介绍自己", "builtin", token, timeout=TIMEOUT)
        if r["error"]:
            return False, r["error"]
        if not r["text"]:
            return False, "empty response"
        session_builtin_ref[0] = r["session_id"]
        return True, f"text={len(r['text'])}ch"

    session_builtin_ref = [None]
    results.append(test("Builtin — greeting", t1))
    session_builtin = session_builtin_ref[0]

    # ── Test 2: Claude Agent greeting ──
    def t2():
        r = sse_chat("你好，一句话介绍自己", "claude_agent", token, timeout=TIMEOUT)
        if r["error"]:
            return False, r["error"]
        if not r["text"]:
            return False, "empty response"
        session_claude_ref[0] = r["session_id"]
        return True, f"text={len(r['text'])}ch"

    session_claude_ref = [None]
    results.append(test("Claude Agent — greeting", t2))
    session_claude = session_claude_ref[0]

    # ── Test 3: Builtin tool call ──
    def t3():
        r = sse_chat("当前连接了哪些数据源？", "builtin", token, timeout=TIMEOUT)
        if r["error"]:
            return False, r["error"]
        has_tool = "tool_call" in r["events"]
        return len(r["text"]) > 0, f"text={len(r['text'])}ch tools={'yes' if has_tool else 'no'}"

    results.append(test("Builtin — tool call (list_sources)", t3))

    # ── Test 4: Builtin session continuity ──
    def t4():
        if not session_builtin:
            return False, "no session from test 1"
        r = sse_chat("你刚才第一句说了什么？", "builtin", token, session_id=session_builtin, timeout=TIMEOUT)
        if r["error"]:
            return False, r["error"]
        return len(r["text"]) > 0, f"text={len(r['text'])}ch"

    results.append(test("Builtin — session continuity", t4))

    # ── Test 5: Claude Agent session continuity ──
    def t5():
        if not session_claude:
            return False, "no session from test 2"
        r = sse_chat("继续上次话题，补充一点", "claude_agent", token, session_id=session_claude, timeout=TIMEOUT)
        if r["error"]:
            return False, r["error"]
        return len(r["text"]) > 0, f"text={len(r['text'])}ch"

    results.append(test("Claude Agent — session continuity", t5))

    # ── Summary ──
    passed = sum(results)
    total = len(results)
    print(f"\nResult: {passed}/{total} passed")

    if passed < total:
        print("\nFailed tests need investigation before releasing to users.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
