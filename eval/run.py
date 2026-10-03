#!/usr/bin/env python3
"""Does Qloo make a difference? Encore against the same model planning without Qloo.

For each persona in personas.json both systems plan the same six moments (an opening song, a film,
a star, a TV show, a hometown landmark, a closing song). Every pick is then checked against Qloo:
does it exist, does it date from the person's teens and twenties, does it come from their culture,
and how often do different people get the same thing.

Usage: python3 eval/run.py            (needs the app on ENCORE_URL, default http://localhost:5180,
                                       and the Encore relay; answers are cached in eval/cache)
"""
import difflib
import hashlib
import json
import os
import re
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, 'cache')
os.makedirs(CACHE, exist_ok=True)
QLOO_KEY = open(os.path.expanduser('~/.config/qloo/api-key')).read().strip()
RELAY_DIR = os.path.expanduser('~/Library/Application Support/Encore')
RELAY_HOST = open(os.path.join(RELAY_DIR, 'relay-host')).read().strip()
RELAY_KEY = open(os.path.join(RELAY_DIR, 'relay', 'relay-key')).read().strip()
APP = os.environ.get('ENCORE_URL', 'http://localhost:5180')
MODEL = 'gpt-5.5'
WAR = ['urn:tag:genre:media:war', 'urn:tag:theme:qloo:war', 'urn:tag:keyword:qloo:war', 'urn:tag:subgenre:qloo:war']
TYPES = {'artist': 'urn:entity:artist', 'movie': 'urn:entity:movie', 'tv_show': 'urn:entity:tv_show',
         'person': 'urn:entity:person', 'place': 'urn:entity:place'}
CAPITAL = {'Mexico': 'Mexico City', 'Puerto Rico': 'San Juan', 'Ireland': 'Dublin', 'Poland': 'Warsaw', 'Cuba': 'Havana',
           'India': 'Mumbai', 'Jamaica': 'Kingston', 'Germany': 'Berlin', 'Greece': 'Athens', 'Portugal': 'Lisbon',
           'Italy': 'Rome', 'France': 'Paris', 'Japan': 'Tokyo', 'Canada': 'Toronto'}
SLOTS = ['opener', 'film', 'star', 'tv', 'place', 'closer']
KIND = {'opener': 'artist', 'film': 'movie', 'star': 'person', 'tv': 'tv_show', 'place': 'place', 'closer': 'artist'}


def cached(name, fn):
    path = os.path.join(CACHE, hashlib.sha1(name.encode()).hexdigest()[:16] + '.json')
    if os.path.exists(path):
        return json.load(open(path))
    value = fn()
    json.dump(value, open(path, 'w'))
    return value


_last = [0.0]


def qloo(path, params):
    def call():
        for attempt in range(4):
            wait = 0.25 - (time.time() - _last[0])
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.time()
            url = 'https://hackathon.api.qloo.com' + path + '?' + urllib.parse.urlencode(params)
            req = urllib.request.Request(url, headers={'X-Api-Key': QLOO_KEY})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(2 * (attempt + 1))
                    continue
                return {'error': e.code}
        return {'error': 'rate'}
    return cached('qloo ' + path + json.dumps(params, sort_keys=True), call)


def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[^a-z0-9 ]+', ' ', s)
    s = re.sub(r'^(the|a|an|la|el|le|il) ', '', s.strip())
    return re.sub(r'\s+', ' ', s).strip()


def similar(a, b, strict=False):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a == b or (not strict and len(a) > 5 and (a in b or b in a)):
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def resolve(name, kind, near=''):
    """The Qloo entity a name refers to, or None if Qloo has nothing close."""
    query = f'{name} {near}'.strip() if kind == 'place' else name
    data = qloo('/search', {'query': query, 'types': TYPES[kind], 'take': 5})
    best, score = None, 0.0
    for e in data.get('results', []):
        # Places need a near-exact name: "Beale Street" must not match a hotel called "... Beale Street".
        s = similar(name, e.get('name', ''), strict=kind == 'place')
        if s > score:
            best, score = e, s
    return best if score >= (0.9 if kind == 'place' else 0.85) else None


def details(entity_id, kind):
    data = qloo('/v2/insights', {'filter.type': TYPES[kind], 'filter.results.entities': entity_id})
    ents = (data.get('results') or {}).get('entities') or []
    return ents[0] if ents else None


def year(v):
    m = re.match(r'(\d{4})', str(v or ''))
    return int(m.group(1)) if m else None


def era_fit(kind, props, by):
    a, b = by + 10, by + 30
    if kind in ('movie', 'tv_show'):
        y = year(props.get('release_year'))
        return None if y is None else a <= y <= b
    if kind == 'artist':
        start, end, born = year(props.get('start_year')), year(props.get('end_year')), year(props.get('date_of_birth'))
        if start:
            return start <= b - 2 and start >= a - 25 and (not end or end >= a)
        if born:
            return a - 45 <= born <= b - 15
        return None
    return None


def from_home(kind, props, heritage):
    """Does it come from the culture they grew up in? Films and TV by country of release, artists by birthplace."""
    if not heritage:
        return None
    country = heritage[0]
    if kind in ('movie', 'tv_show'):
        rc = props.get('release_country') or []
        rc = rc if isinstance(rc, list) else [rc]
        return any(country.lower() in str(c).lower() for c in rc)
    if kind == 'artist':
        pob = str(props.get('place_of_birth') or '')
        if not pob:
            return None
        return country.lower() in pob.lower() or CAPITAL.get(country, '~').lower() in pob.lower()
    return None


def relay(body):
    req = urllib.request.Request(f'https://{RELAY_HOST}/responses', data=json.dumps({**body, 'store': False, 'stream': True}).encode(),
                                 headers={'content-type': 'application/json', 'x-relay-key': RELAY_KEY, 'user-agent': 'encore-eval/1.0'})
    text = ''
    with urllib.request.urlopen(req, timeout=180) as r:
        for raw in r:
            line = raw.decode().strip()
            if line.startswith('data:') and '"response.output_text.delta"' in line:
                text += json.loads(line[5:]).get('delta', '')
    return text


BASELINE = {
    'type': 'object', 'additionalProperties': False,
    'required': ['opener', 'film', 'star', 'tv', 'place', 'closer'],
    'properties': {
        'opener': {'type': 'object', 'additionalProperties': False, 'required': ['artist', 'song'], 'properties': {'artist': {'type': 'string'}, 'song': {'type': 'string'}}},
        'film': {'type': 'object', 'additionalProperties': False, 'required': ['title', 'year'], 'properties': {'title': {'type': 'string'}, 'year': {'type': 'integer'}}},
        'star': {'type': 'object', 'additionalProperties': False, 'required': ['name'], 'properties': {'name': {'type': 'string'}}},
        'tv': {'type': 'object', 'additionalProperties': False, 'required': ['title', 'year'], 'properties': {'title': {'type': 'string'}, 'year': {'type': 'integer'}}},
        'place': {'type': 'object', 'additionalProperties': False, 'required': ['name'], 'properties': {'name': {'type': 'string'}}},
        'closer': {'type': 'object', 'additionalProperties': False, 'required': ['artist', 'song'], 'properties': {'artist': {'type': 'string'}, 'song': {'type': 'string'}}},
    },
}

BASELINE_INSTRUCTIONS = (
    'You plan a 20-minute reminiscence session for one person living with dementia. Choose what they most likely loved '
    'when they were about 10 to 30 years old, from the culture they grew up in, building on their favourites. Avoid anything '
    'likely to upset them (war, violence, death, horror). Pick: an opening song (artist and song), a film, a star of their '
    'day, a TV show, a landmark in their hometown, and a closing song by a different artist. Real titles only.'
)


def baseline(p):
    person = {'born': p['birthYear'], 'hometown': p['hometown'], 'heritage': p['heritage'], 'language': p.get('language', 'English'),
              'favourites': [f[0] for f in p['favorites']], 'avoid': ['War']}
    body = {'model': MODEL, 'instructions': BASELINE_INSTRUCTIONS,
            'input': [{'role': 'user', 'content': [{'type': 'input_text', 'text': json.dumps(person)}]}],
            'reasoning': {'effort': 'low'},
            'text': {'format': {'type': 'json_schema', 'name': 'session', 'strict': True, 'schema': BASELINE}}}
    out = cached('baseline v1 ' + json.dumps(body, sort_keys=True), lambda: json.loads(relay(body)))
    return {
        'opener': out['opener']['artist'], 'film': out['film']['title'], 'star': out['star']['name'],
        'tv': out['tv']['title'], 'place': out['place']['name'], 'closer': out['closer']['artist'],
        'raw': out,
    }


def encore(p, favorites):
    taste = {'birthYear': p['birthYear'], 'hometown': p['hometown'], 'heritage': p['heritage'], 'language': p.get('language'),
             'favorites': favorites, 'avoidTags': WAR}

    def call():
        req = urllib.request.Request(APP + '/api/session', data=json.dumps(taste).encode(), headers={'content-type': 'application/json'})
        with urllib.request.urlopen(req, timeout=240) as r:
            return json.loads(r.read())
    out = cached('encore v2 ' + json.dumps(taste, sort_keys=True), call)
    s = out['session']
    picks = {slot['key']: slot['item'] for slot in s['slots']}
    return {k: picks.get(k) for k in SLOTS}, s.get('narration')


def check(name, kind, p, entity_id=None):
    """Look an item up in Qloo and score it."""
    ent = details(entity_id, kind) if entity_id else None
    if not ent and name:
        found = resolve(name, kind, p['hometown'])
        ent = details(found['entity_id'], kind) if found and kind != 'place' else found
    if not ent:
        return {'name': name, 'asked': name, 'found': False}
    props = ent.get('properties') or {}
    return {'name': ent.get('name', name), 'asked': name, 'found': True, 'era': era_fit(kind, props, p['birthYear']),
            'home': from_home(kind, props, p['heritage']),
            'year': year(props.get('release_year') or props.get('start_year') or props.get('date_of_birth')),
            'country': props.get('release_country') or props.get('place_of_birth')}


def share(rows, key):
    vals = [r[key] for r in rows if r.get(key) is not None]
    return (sum(1 for v in vals if v) / len(vals), len(vals)) if vals else (None, 0)


def main():
    personas = json.load(open(os.path.join(ROOT, 'personas.json')))
    rows = {'encore': [], 'baseline': []}
    per_persona = []
    for p in personas:
        favorites = []
        for name, kind in p['favorites']:
            e = resolve(name, kind)
            if e:
                favorites.append({'id': e['entity_id'], 'name': e['name'], 'type': TYPES[kind]})
        print(f"{p['id']} born {p['birthYear']} {p['hometown']} {p['heritage']} favourites={[f['name'] for f in favorites]}", flush=True)
        t = time.time()
        enc, narration = encore(p, favorites)
        base = baseline(p)
        record = {'persona': p, 'encore': {}, 'baseline': {}, 'narration': narration}
        for slot in SLOTS:
            kind = KIND[slot]
            it = enc.get(slot)
            e = check(it['name'], kind, p, it['id'] if kind != 'place' else None) if it else {'name': None, 'found': False}
            if it and kind == 'place':
                e = {'name': it['name'], 'asked': it['name'], 'found': True, 'era': None, 'home': None}
            b = check(base[slot], kind, p)
            for system, r in (('encore', e), ('baseline', b)):
                r.update({'slot': slot, 'kind': kind, 'persona': p['id'], 'abroad': bool(p['heritage'])})
                rows[system].append(r)
                record[system][slot] = r
        per_persona.append(record)
        print(f"   {time.time() - t:5.1f}s  encore: {[record['encore'][s]['name'] for s in SLOTS]}", flush=True)
        print(f"          baseline: {[record['baseline'][s]['name'] for s in SLOTS]}", flush=True)

    summary = {}
    for system in rows:
        r = rows[system]
        media = [x for x in r if x['kind'] in ('movie', 'tv_show', 'artist')]
        found = sum(1 for x in r if x['found']) / len(r)
        era, n_era = share(media, 'era')
        home_media = [x for x in media if x['abroad']]
        home, n_home = share(home_media, 'home')
        film_tv_home, n_ft = share([x for x in home_media if x['kind'] in ('movie', 'tv_show')], 'home')
        names = Counter(norm(x['asked']) for x in r if x.get('asked'))
        repeated = sum(c for c in names.values() if c >= 3) / max(1, sum(names.values()))
        summary[system] = {
            'items': len(r), 'found_in_qloo': round(found, 3),
            'era_fit': round(era, 3) if era is not None else None, 'era_checked': n_era,
            'home_culture': round(home, 3) if home is not None else None, 'home_checked': n_home,
            'home_culture_film_tv': round(film_tv_home, 3) if film_tv_home is not None else None, 'home_film_tv_checked': n_ft,
            'distinct_items': len(names), 'share_in_3plus_personas': round(repeated, 3),
            'most_repeated': [[n, c] for n, c in names.most_common(6) if c > 1],
        }
    json.dump({'summary': summary, 'personas': per_persona}, open(os.path.join(ROOT, 'results.json'), 'w'), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    sys.exit(main())
