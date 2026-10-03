"""Call /api/session with a persona file and print a readable summary.

Usage: python3 scripts/try-session.py personas/dorothy.json [base-url]
"""
import json
import sys
import urllib.request

BASE = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:5180'
persona = json.load(open(sys.argv[1]))
req = urllib.request.Request(BASE + '/api/session', data=json.dumps(persona).encode(),
                             headers={'Content-Type': 'application/json', 'User-Agent': 'encore-try/1.0'})
with urllib.request.urlopen(req, timeout=180) as r:
    d = json.loads(r.read())
s = d['session']
print('window', s['window'], 'narration', s.get('narration'), s.get('model'), 'stats', d.get('stats'))
for t in s['trace']:
    print(f"  · {t['tool']:<14} {str(t.get('count', '')):>3}  {str(t.get('ms', '')):>5}ms  {t['detail']}")
for slot in s['slots']:
    it = slot['item']
    because = ', '.join(f"{b['name']} {b['share']}" for b in it.get('because', []))
    print(f"\n[{slot['title']}] {it['name']} ({it.get('when') or ''}) feature={it.get('feature')!r} aff={it.get('affinity')} pop={it.get('popularity')}")
    print(f"    because: {because}")
    print(f"    alternates: {[a['name'] + ' ' + (a.get('when') or '') for a in slot['alternates']]}")
    for p in it.get('prompts', []):
        print(f"    - {p}")
    if it.get('sensory'):
        print(f"    * {it['sensory']}")
