"""Summarise CPU time per invocation from `wrangler tail --format json` output (pretty-printed objects).

Usage: python3 scripts/tail-cpu.py <tail file> [version-id prefix]
"""
import json
import re
import sys
from collections import defaultdict

text = open(sys.argv[1], errors='replace').read().replace('\x00', '')
prefix = sys.argv[2] if len(sys.argv) > 2 else ''
rows = []
# Each event is an object that starts with "{" and ends with "}" at the start of a line.
for chunk in re.split(r'(?m)^\}\s*$', text):
    start = chunk.find('{')
    if start < 0:
        continue
    try:
        rows.append(json.loads(chunk[start:] + '}'))
    except json.JSONDecodeError:
        pass
rows = [r for r in rows if (r.get('scriptVersion') or {}).get('id', '').startswith(prefix)]
groups = defaultdict(list)
for r in rows:
    ev = r.get('event') or {}
    url = (ev.get('request') or {}).get('url', '')
    name = ev.get('rpcMethod') or re.sub(r'^https?://[^/]+', '', url).split('?')[0]
    groups[f"{r.get('entrypoint') or 'main'} {name}"].append((r.get('cpuTime') or 0, r.get('outcome')))
for key, vals in sorted(groups.items()):
    cpus = sorted(c for c, _ in vals)
    bad = [o for _, o in vals if o != 'ok']
    print(f"{key:32} n={len(cpus):3}  max={cpus[-1]:3}ms  median={cpus[len(cpus) // 2]:3}ms  over10={sum(c > 10 for c in cpus):2}  {('not ok: ' + ','.join(bad)) if bad else ''}")
