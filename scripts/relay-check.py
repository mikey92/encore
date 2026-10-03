"""Send one small Responses call through the Encore relay and print the reply and timing.

Usage: python3 scripts/relay-check.py [model ...]
The relay key is read from its 600 file and never printed.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.path.expanduser('~/Library/Application Support/Encore')
HOST = open(os.path.join(BASE, 'relay-host')).read().strip()
KEY = open(os.path.join(BASE, 'relay', 'relay-key')).read().strip()


def ask(model, effort='low'):
    body = {
        'model': model,
        'instructions': 'You write short, warm conversation prompts for reminiscence sessions with older adults.',
        'input': [{'role': 'user', 'content': [{'type': 'input_text', 'text': 'One open question about the 1965 film The Sound of Music. No yes/no questions.'}]}],
        'reasoning': {'effort': effort},
        'store': False,
        'stream': True,
    }
    req = urllib.request.Request(f'https://{HOST}/responses', data=json.dumps(body).encode(),
                                 headers={'content-type': 'application/json', 'x-relay-key': KEY,
                                          # Cloudflare's browser check on the zone rejects Python's default agent (error 1010).
                                          'user-agent': 'encore-relay-check/1.0'})
    t = time.time()
    text, usage = '', None
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            buf = ''
            for raw in r:
                buf += raw.decode()
                while '\n\n' in buf:
                    block, buf = buf.split('\n\n', 1)
                    data = ''.join(l[5:].strip() for l in block.split('\n') if l.startswith('data:'))
                    if not data or data == '[DONE]':
                        continue
                    ev = json.loads(data)
                    if ev.get('type') == 'response.output_text.delta':
                        text += ev.get('delta', '')
                    if ev.get('type') == 'response.completed':
                        usage = ev['response'].get('usage')
                    if ev.get('type') in ('response.failed', 'error'):
                        return f'FAILED: {json.dumps(ev)[:300]}'
    except urllib.error.HTTPError as e:
        return f'HTTP {e.code}: {e.read()[:300]!r}'
    return f'{time.time() - t:.1f}s usage={usage and {k: usage.get(k) for k in ("input_tokens", "output_tokens")}} | {text.strip()}'


for m in sys.argv[1:] or ['gpt-5.5']:
    print(m, '->', ask(m))
