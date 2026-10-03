"""How long does a curator-sized call take for different models and reasoning efforts?

Usage: python3 scripts/curator-bench.py model:effort [model:effort ...]
"""
import json
import os
import re
import sys
import time
import urllib.request

B = os.path.expanduser('~/Library/Application Support/Encore')
HOST = open(os.path.join(B, 'relay-host')).read().strip()
KEY = open(os.path.join(B, 'relay', 'relay-key')).read().strip()
src = open(os.path.join(os.path.dirname(__file__), '..', 'worker', 'curate.ts')).read()
INSTRUCTIONS = re.search(r'const INSTRUCTIONS = `([\s\S]*?)`', src).group(1)

moment = {'type': 'object', 'additionalProperties': False,
          'required': ['key', 'pick', 'alternates', 'why', 'prompts', 'prompts_native', 'sensory', 'rejected'],
          'properties': {'key': {'type': 'string'}, 'pick': {'type': 'string'}, 'alternates': {'type': 'array', 'items': {'type': 'string'}},
                         'why': {'type': 'string'}, 'prompts': {'type': 'array', 'items': {'type': 'string'}},
                         'prompts_native': {'type': 'array', 'items': {'type': 'string'}}, 'sensory': {'type': 'string'},
                         'rejected': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['id', 'reason'],
                                                                 'properties': {'id': {'type': 'string'}, 'reason': {'type': 'string'}}}}}}
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['opening', 'closing', 'moments'],
          'properties': {'opening': {'type': 'string'}, 'closing': {'type': 'string'}, 'moments': {'type': 'array', 'items': moment}}}

names = {
    'opener': ['Desmond Dekker', 'John Holt', 'Derrick Morgan', 'Toots and The Maytals', 'The Skatalites'],
    'film': ['The Harder They Come', "A Hard Day's Night", 'Mary Poppins', 'Dr. No', 'Smile Orange'],
    'star': ['Bob Marley', 'Peter Tosh', 'Jimmy Cliff', 'Tommy Chong', 'Louise Bennett-Coverley'],
    'tv': ['I Love Lucy', 'Columbo', 'Spider-Man', 'Great Performances', 'Ring Ding'],
    'place': ['Hope Botanical Gardens', 'Devon House', 'Bob Marley Museum', 'Emancipation Park', 'National Gallery of Jamaica'],
    'closer': ['Toots and The Maytals', 'The Ethiopians', 'The Skatalites', 'Millie Small', 'Prince Buster'],
}
INPUT = json.dumps({
    'person': {'born': 1944, 'youth_years': [1954, 1974], 'hometown': 'Kingston', 'heritage': ['Jamaica'], 'home_language': None,
               'favourites': ['Desmond Dekker'], 'avoid': ['War'], 'notes': None},
    'moments': [{'key': k, 'title': k, 'candidates': [{'id': f'{k}-{i}', 'name': n, 'when': '1960s', 'about': f'{n} is well known in Jamaica for work in the 1960s and 1970s, loved across generations.', 'tags': ['Reggae', 'Ska', 'Classic']} for i, n in enumerate(v)]} for k, v in names.items()],
})


def run(model, effort):
    body = {'model': model, 'instructions': INSTRUCTIONS, 'input': [{'role': 'user', 'content': [{'type': 'input_text', 'text': INPUT}]}],
            'reasoning': {'effort': effort}, 'store': False, 'stream': True,
            'text': {'format': {'type': 'json_schema', 'name': 'session', 'strict': True, 'schema': SCHEMA}}}
    req = urllib.request.Request(f'https://{HOST}/responses', data=json.dumps(body).encode(),
                                 headers={'content-type': 'application/json', 'x-relay-key': KEY, 'user-agent': 'encore-bench/1.0'})
    t = time.time()
    usage, first = None, None
    with urllib.request.urlopen(req, timeout=180) as r:
        for raw in r:
            line = raw.decode().strip()
            if first is None and '"response.output_text.delta"' in line:
                first = time.time() - t
            if line.startswith('data:') and '"response.completed"' in line:
                usage = json.loads(line[5:])['response'].get('usage')
    return f'{model}:{effort} total {time.time() - t:.1f}s, first text {first:.1f}s, usage {usage and {k: usage.get(k) for k in ("input_tokens", "output_tokens")}}'


for arg in sys.argv[1:]:
    m, e = arg.split(':')
    try:
        print(run(m, e), flush=True)
    except Exception as ex:
        print(arg, 'failed', ex, flush=True)
