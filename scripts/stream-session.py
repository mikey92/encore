"""Plan a session through the streaming API and print each event with its time.

Usage: python3 scripts/stream-session.py p17            (an eval persona; favourites are looked up first)
       python3 scripts/stream-session.py personas/x.json [base-url]
"""
import json
import sys
import time
import urllib.request

BASE = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:5180'
HEADERS = {'Content-Type': 'application/json', 'User-Agent': 'encore-try/1.0'}
WAR = ['urn:tag:genre:media:war', 'urn:tag:theme:qloo:war', 'urn:tag:keyword:qloo:war', 'urn:tag:subgenre:qloo:war']
TYPES = {'artist': 'urn:entity:artist', 'movie': 'urn:entity:movie', 'tv_show': 'urn:entity:tv_show', 'person': 'urn:entity:person'}


def post(path, body, timeout=60):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=HEADERS)
    return urllib.request.urlopen(req, timeout=timeout)


def taste_for(arg):
    if arg.endswith('.json'):
        return json.load(open(arg))
    people = json.load(open('eval/personas.json'))
    people = people if isinstance(people, list) else people['personas']
    p = next(x for x in people if x['id'] == arg)
    favorites = []
    for name, kind in p['favorites']:
        found = json.loads(post('/api/search', {'q': name, 'types': [TYPES[kind]]}).read())['results']
        if found:
            favorites.append({'id': found[0]['id'], 'name': found[0]['name'], 'type': TYPES[kind]})
    return {'birthYear': p['birthYear'], 'hometown': p['hometown'], 'heritage': p['heritage'],
            'language': p.get('language'), 'favorites': favorites, 'avoidTags': WAR}


taste = taste_for(sys.argv[1])
print('taste', {k: taste.get(k) for k in ('birthYear', 'hometown', 'heritage', 'language')},
      [f['name'] for f in taste.get('favorites', [])])
t = time.time()
with post('/api/session?stream=1', taste, timeout=180) as r:
    for line in r:
        e = json.loads(line)
        dt = time.time() - t
        if e['type'] == 'step':
            if e['step']['tool'] != 'qloo.insights':
                print(f"{dt:5.1f}s {e['step']['tool']}: {e['step']['detail']}")
        elif e['type'] == 'moment':
            print(f"{dt:5.1f}s moment {e['slot']['key']}: {e['slot']['item']['name']}")
        elif e['type'] == 'plan':
            print(f"{dt:5.1f}s plan: {[(x['key'], x['item']['name']) for x in e['session']['slots']]}")
        elif e['type'] == 'curated':
            s = e['session']
            print(f"{dt:5.1f}s curated")
            print('   opening:', s.get('opening'))
            for x in s['slots']:
                it = x['item']
                print(f"   {x['key']:7} {it['name']} ({it.get('when')}) src={it.get('source', 'qloo')} alt={[a['name'] for a in x['alternates']]}")
                for q in it.get('prompts') or []:
                    print('        -', q)
            print('   closing:', s.get('closing'))
            for k in s.get('skipped', []):
                print('   skip', k['name'], '-', k['reason'])
        else:
            print(f"{dt:5.1f}s {e['type']} {e.get('stats') or e.get('message')}")
