#!/usr/bin/env python3
"""Write eval/REPORT.md from eval/results.json."""
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(ROOT, 'results.json')))
S = data['summary']
E, B = S['encore'], S['baseline']
SLOTS = ['opener', 'film', 'star', 'tv', 'place', 'closer']


def pct(x):
    return '–' if x is None else f'{round(100 * x)}%'


lines = [
    '# Does Qloo make a difference?',
    '',
    f"Encore against the same model ({data.get('model', 'gpt-5.5')}) planning the same session without Qloo, for "
    f"{len(data['personas'])} people born 1932–1955 in the U.S. and abroad (`personas.json`). Both get the same facts: year of "
    'birth, hometown, family roots, home language, one or two favourites, and "avoid war". Both pick the same six moments: an '
    'opening song, a film, a star, a TV show, a hometown landmark and a closing song. Every pick is then looked up in Qloo '
    '(`run.py`).',
    '',
    '| | Encore | Model without Qloo |',
    '| --- | --- | --- |',
    f"| Picks that resolve to a Qloo entity | {pct(E['found_in_qloo'])} | {pct(B['found_in_qloo'])} |",
    f"| Songs, films and TV from their teens and twenties (ages 10–30) | {pct(E['era_fit'])} of {E['era_checked']} | {pct(B['era_fit'])} of {B['era_checked']} |",
    f"| For people with roots abroad: films and TV made in that country | {pct(E['home_culture_film_tv'])} of {E['home_film_tv_checked']} | {pct(B['home_culture_film_tv'])} of {B['home_film_tv_checked']} |",
    f"| For people with roots abroad: films, TV and artists from that country | {pct(E['home_culture'])} of {E['home_checked']} | {pct(B['home_culture'])} of {B['home_checked']} |",
    f"| Distinct picks across all {len(data['personas'])} people | {E['distinct_items']} | {B['distinct_items']} |",
    f"| Picks shared by three or more people | {pct(E['share_in_3plus_personas'])} | {pct(B['share_in_3plus_personas'])} |",
    '',
    '**Most repeated picks**',
    '',
    f"- Encore: {', '.join(f'{n} ({c})' for n, c in E['most_repeated']) or 'none'}",
    f"- Model without Qloo: {', '.join(f'{n} ({c})' for n, c in B['most_repeated']) or 'none'}",
    '',
    '## How to read this',
    '',
    '- *Resolves to a Qloo entity*: every Encore pick is a Qloo entity by construction, with an image, a link and the '
    'favourite it comes from. A model-only pick that does not resolve may be real but obscure, or misremembered; either '
    'way it cannot be shown with a picture, checked for era, or explained.',
    '- *Era* uses Qloo’s release year for films and TV, and the first year of recording for artists. Picks that could '
    'not be checked are left out of the share, so the denominators differ.',
    '- *From home* uses the country of release for films and TV, and the birthplace for artists. It is a rough test: '
    'Tito Puente was born in New York.',
    '- Stars and landmarks are not scored for era or culture.',
    '',
    '## Side by side',
    '',
    '| Person | System | Song | Film | Star | TV | Landmark | Closing song |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
]


def cell(r):
    if not r:
        return '–'
    name = (r.get('asked') or r.get('name') or '–').replace('|', '/')
    marks = ''
    if r.get('found') is False:
        marks += ' ✗'
    if r.get('era') is False:
        marks += ' ⌛'
    return name + marks


for rec in data['personas']:
    p = rec['persona']
    who = f"{p['birthYear']}, {p['hometown']}" + (f" ({', '.join(p['heritage'])})" if p['heritage'] else '')
    lines.append(f"| {who} | Encore | " + ' | '.join(cell(rec['encore'].get(s)) for s in SLOTS) + ' |')
    lines.append('| | Model only | ' + ' | '.join(cell(rec['baseline'].get(s)) for s in SLOTS) + ' |')

lines += ['', '✗ not found in Qloo · ⌛ outside the years they were 10 to 30', '']
open(os.path.join(ROOT, 'REPORT.md'), 'w').write('\n'.join(lines))
print('wrote eval/REPORT.md')
