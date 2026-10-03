#!/usr/bin/env python3
"""Write eval/REPORT.md from the eval results.

results-v5.json (or $ENCORE_VARIANT): Encore as deployed (Qloo insights + research grounded in Qloo + curator)
results-v3.json: Encore with Qloo insights only (ablation), if present
Both files carry the same model-only baseline.
"""
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))


def load(name):
    path = os.path.join(ROOT, name)
    return json.load(open(path)) if os.path.exists(path) else None


main = load(f"results-{os.environ.get('ENCORE_VARIANT', 'v5')}.json") or load('results.json')
ablation = load('results-v3.json') if main and main.get('variant') != 'v3' else None
SLOTS = ['opener', 'film', 'star', 'tv', 'place', 'closer']
E, B = main['summary']['encore'], main['summary']['baseline']
Q = ablation['summary']['encore'] if ablation else None
n = len(main['personas'])


def pct(x):
    return '–' if x is None else f'{round(100 * x)}%'


def row(label, key, of=None):
    cells = [E, Q, B] if Q else [E, B]
    vals = []
    for c in cells:
        v = pct(c[key]) if isinstance(c[key], float) or c[key] is None else str(c[key])
        if of:
            v += f' of {c[of]}'
        vals.append(v)
    return f'| {label} | ' + ' | '.join(vals) + ' |'


head = '| | Encore | Encore, Qloo only | Model without Qloo |' if Q else '| | Encore | Model without Qloo |'
lines = [
    '# Does Qloo make a difference?',
    '',
    f"Encore against the same model ({main.get('model', 'gpt-5.5')}) planning the same session on its own, for {n} people "
    'born 1932–1955 in the U.S. and abroad ([personas.json](personas.json)). Everyone gets the same facts: year of birth, '
    'hometown, family roots, home language, one or two favourites, and "avoid war". Both plan the same six moments: an opening '
    'song, a film, a star, a TV show, a hometown landmark and a closing song. Every pick is then looked up in Qloo '
    '([run.py](run.py)).',
    '',
    '- **Encore** is the deployed app: Qloo insights, plus titles a research step suggests that Qloo can ground (the entity '
    'exists, it dates from their youth, and Qloo scores its affinity to their favourites), then the curator.',
] + (['- **Encore, Qloo only** leaves out the research step (an ablation).'] if Q else []) + [
    '- **Model without Qloo** is the same model given the same facts and asked for the same six moments.',
    '',
    head,
    '| --- | --- | --- | --- |' if Q else '| --- | --- | --- |',
    row('Picks that resolve to a Qloo entity', 'found_in_qloo'),
    row('Songs, films and TV from their teens and twenties', 'era_fit', 'era_checked'),
    row('Roots abroad: films and TV made in that country', 'home_culture_film_tv', 'home_film_tv_checked'),
    row('Roots abroad: films, TV and artists from that country', 'home_culture', 'home_checked'),
    row(f'Distinct picks across all {n} people', 'distinct_items'),
    row('Picks shared by three or more people', 'share_in_3plus_personas'),
    '',
    '**Most repeated picks**',
    '',
    f"- Encore: {', '.join(f'{x} ({c})' for x, c in E['most_repeated']) or 'none'}",
] + ([f"- Encore, Qloo only: {', '.join(f'{x} ({c})' for x, c in Q['most_repeated']) or 'none'}"] if Q else []) + [
    f"- Model without Qloo: {', '.join(f'{x} ({c})' for x, c in B['most_repeated']) or 'none'}",
    '',
    '## How to read this',
    '',
    '- *Resolves to a Qloo entity*: every Encore pick is a Qloo entity by construction, so it comes with a picture, a link, '
    'its years and the favourite it connects to. A model-only pick that does not resolve may be real but obscure, or '
    'misremembered; either way it cannot be shown, dated or explained.',
    '- *Era* uses Qloo’s release year for films and TV and the first year of recording for artists; picks that could not '
    'be checked are left out of the share, so the denominators differ.',
    '- *From that country* uses the country of release for films and TV and the birthplace for artists. It is a rough '
    'test: Tito Puente was born in New York.',
    '- Stars and landmarks are not scored for era or culture. Twenty-four people is a small sample; read the side-by-side '
    'table as much as the numbers.',
    '',
    '## Side by side',
    '',
    '| Person | | Song | Film | Star | TV | Landmark | Closing song |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
]


def cell(r):
    if not r or not (r.get('asked') or r.get('name')):
        return '–'
    name = (r.get('asked') or r.get('name')).replace('|', '/')
    marks = ''
    if r.get('found') is False:
        marks += ' ✗'
    if r.get('era') is False:
        marks += ' ⌛'
    return name + marks


abl = {rec['persona']['id']: rec for rec in ablation['personas']} if ablation else {}
for rec in main['personas']:
    p = rec['persona']
    who = f"{p['birthYear']}, {p['hometown']}" + (f" ({', '.join(p['heritage'])})" if p['heritage'] else '')
    lines.append(f'| {who} | Encore | ' + ' | '.join(cell(rec['encore'].get(s)) for s in SLOTS) + ' |')
    if p['id'] in abl:
        lines.append('| | Qloo only | ' + ' | '.join(cell(abl[p['id']]['encore'].get(s)) for s in SLOTS) + ' |')
    lines.append('| | Model only | ' + ' | '.join(cell(rec['baseline'].get(s)) for s in SLOTS) + ' |')

lines += ['', '✗ not found in Qloo · ⌛ outside the years they were 10 to 30 · – no pick (the curator may leave a moment out)', '']
open(os.path.join(ROOT, 'REPORT.md'), 'w').write('\n'.join(lines))
print('wrote eval/REPORT.md')
