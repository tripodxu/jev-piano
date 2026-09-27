#!/usr/bin/env python3
# dev-proxy.py — 本地开发服务器：静态服务 public/ + 三个 API。
#   GET  /api/probe → 能力探测
#   POST /api/jev   → 有 TYPESAFE_API_KEY 环境变量时真转发；否则返回与真实 API 同构的模拟决策
#   POST /api/llm   → 有 LLM_* 环境变量时真转发；否则 501
# 用法：python dev-proxy.py [--port 8000]
import argparse
import json
import os
import random
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "public"
TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone"
TYPESAFE_MODEL = "jev-latest"


def forward(url, key, payload):
    """转发到 TypeSafe。优先 requests（部分 Windows 环境 urllib TLS 会挂起），退回 urllib。"""
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    try:
        import requests
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=30)
            return r.status_code, r.content
        except Exception as e:  # 网络错误统一 502
            return 502, json.dumps({"error": f"forward failed: {e}"}).encode()
    except ImportError:
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.status, res.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception as e:
            return 502, json.dumps({"error": f"forward failed: {e}"}).encode()


def mock_answers(questions):
    """按真实 API 的响应形态返回模拟决策（choice 键均匀采样 / score 等级 / noul 概率）。"""
    answers = {}
    for qid, q in (questions or {}).items():
        qtype = q.get("type")
        criteria = q.get("criteria") or {}
        if qtype == "choice":
            keys = list(criteria.keys())
            pick = random.choice(keys) if keys else None
            answers[qid] = {"type": "choice", "choice": pick, "confidence": 0.5,
                            "probabilities": {k: 1 / len(keys) for k in keys} if keys else {}}
        elif qtype == "score":
            levels = criteria if isinstance(criteria, list) else list(criteria.keys())
            idx = random.randrange(len(levels)) if levels else 0
            answers[qid] = {"type": "score", "score": idx, "confidence": 0.5,
                            "probabilities": {str(i): 1 / len(levels) for i in range(len(levels))}}
        else:  # noul
            p = 0.3
            answers[qid] = {"type": "noul", "noul": p}
    return answers


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, status, body: bytes, ctype="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api(self):
        key = os.environ.get("TYPESAFE_API_KEY", "")
        has_llm = bool(os.environ.get("LLM_BASE_URL") and os.environ.get("LLM_API_KEY") and os.environ.get("LLM_MODEL"))
        return key, has_llm

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/probe":
            key, has_llm = self._api()
            body = json.dumps({"ok": True, "jev": "key" if key else "mock", "llm": has_llm}).encode()
            return self._send(200, body)
        return self._static(path)

    def do_POST(self):
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        key, has_llm = self._api()

        if path == "/api/jev":
            payload = json.loads(raw.decode() or "{}")
            if key:
                status, data = forward(TYPESAFE_URL, key, {"model": TYPESAFE_MODEL,
                                                           "state": payload.get("state"),
                                                           "questions": payload.get("questions")})
                return self._send(status, data)
            answers = mock_answers(payload.get("questions"))
            usage = {"input_tokens": 800 + random.randrange(400), "output_tokens": 80}
            return self._send(200, json.dumps({"model": "dev-mock", "answers": answers, "usage": usage}).encode())

        if path == "/api/llm":
            if not has_llm:
                return self._send(501, json.dumps({"error": "dev-proxy 未配置 LLM_* 环境变量"}).encode())
            payload = json.loads(raw.decode() or "{}")
            base = os.environ["LLM_BASE_URL"].rstrip("/")
            status, data = forward(base + "/chat/completions", os.environ["LLM_API_KEY"], payload)
            return self._send(status, data)

        return self._send(404, b'{"error":"not found"}')

    def _static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        target = (ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(ROOT.resolve())) or not target.is_file():
            return self._send(404, b"not found", "text/plain")
        ctypes = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png"}
        ctype = ctypes.get(target.suffix, "application/octet-stream") + "; charset=utf-8"
        return self._send(200, target.read_bytes(), ctype)

    def log_message(self, fmt, *args):
        print("[dev-proxy]", fmt % args)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    print(f"jev-piano dev server → http://127.0.0.1:{args.port}  (Jev: "
          f"{'真实转发' if os.environ.get('TYPESAFE_API_KEY') else '模拟决策'})")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
