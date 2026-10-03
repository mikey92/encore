# Encore

**Reminiscence sessions for people living with dementia, built from their own youth.**

Live app: **https://encore.mikey9220.workers.dev** (no sign-up; three example people are ready to try)

Encore plans a 20-minute session a caregiver can run at a bedside or a kitchen table: a song they love, a film, a
star of their day, a TV show, a landmark from their hometown and a closing song, all from the years they remember
best. It uses [Qloo](https://qloo.com)'s taste graph to find what *this* person most likely loved, then an AI
curator checks every pick for safety, era and culture and writes the conversation prompts, in the person's own
language when that isn't English.

## Why

Reminiscence work with music, film and photographs is a mainstay of dementia care, and it works best when the
material is personal. In practice, activity programs play the same few oldies for everyone. A Mexican-born
grandmother in San Antonio gets Glenn Miller instead of Pedro Infante; a Korean War veteran gets a war film.
Staff rarely have time to research each resident, and families often don't know what a parent loved at nineteen.

## What it does

- **Plans a session** from a birth year, a hometown, family roots and one or two favourites. Moments come from the
  person's reminiscence bump (about ages 10 to 30), which is when memories are most vivid.
- **Researches, then lets Qloo decide**: Qloo's taste signals know less about older films, TV and stars from
  outside the U.S., so a research assistant suggests what people of the person's background loved (Aliki
  Vougiouklaki for an Athenian born in 1940, Hockey Night in Canada for a Torontonian). Every suggestion has to
  resolve to a Qloo entity from the person's youth and is scored against their favourites; Qloo drops the rest.
- **Explains every pick**: "Because Dorothy loves The Sound of Music (58%) and Elvis Presley (42%)", from Qloo's
  explainability.
- **Curates for safety**: a model reviews Qloo's candidates and leaves out anything likely to upset someone with
  dementia (stories about violence or loss, political figures, places tied to tragedy, attractions that didn't
  exist yet), and says why. It can only choose among Qloo's candidates, so nothing is invented. It reviews all
  moments side by side and each one updates on screen as soon as it is done.
- **Speaks their language**: prompts in Spanish, Greek, Hindi… with the English underneath for staff.
- **This or That**: when nobody can name a favourite, the person points at one of two era-right choices. Music first;
  their picks then steer which films Encore asks about next.
- **Learns**: tap how each moment landed. What lit them up becomes a stronger signal next time; anything that
  unsettled them is left out for good.
- **Ask Encore**: tell it what to change in plain words ("It's December, make it festive", "nothing about the sea,
  her brother was lost at sea"). A tool-using agent looks it up in Qloo (entities and tags) and plans again.
- **Group sessions**: several residents at one table. Everyone's taste counts equally, everyone gets a moment that
  is theirs, anything one person must avoid is avoided for all, and Qloo's compare endpoint names what the group
  shares.
- **MCP server** at `/mcp`, so an agent people already use can plan sessions with Encore's tools.

## How it uses Qloo

| Need | Qloo |
| --- | --- |
| Turn "Pedro Infante" into an entity | `GET /search` |
| Music, films, TV, stars, landmarks fans of their favourites love | `POST /v2/insights` with weighted `signal.interests.entities` |
| Only things from their youth | `filter.release_year.min/max` (film, TV), `filter.date_of_birth.min/max` (stars), artists' `start_year` |
| Things from home | `filter.release_country`, `signal.location.query` for the hometown and the country of family roots |
| Leave out themes | `filter.exclude.tags` (war, death, violence, horror, and whatever Ask Encore finds), `filter.exclude.entities` |
| Steer toward a holiday or hobby | `signal.interests.tags` |
| Say why | `feature.explainability` |
| The song to play | artists' `notable_songs` via `filter.results.entities` |
| Ground the research assistant's suggestions | `GET /search`, then `filter.results.entities` with the person's signals to score them |
| Hometown landmarks | `filter.location.query` with landmark and tourist-attraction tags |
| What a group shares | `GET /v2/analysis/compare` |
| Ask Encore's lookups | `GET /search`, `GET /v2/tags` |

## How it decides

```
birth year, hometown, roots, favourites
        │
        ├──────────────────────────────────────────────┐
        ▼                                              ▼
Qloo insights ── music · films · TV · stars ·    research assistant ── what people of this
        landmarks (10–30 years window, home              background loved then
        culture, exclusions), ranked by affinity,              │
        familiarity and fit with their youth                   ▼
        │                                          Qloo checks each one: does it exist,
        ▼                                          is it from their youth, how well does it
a first plan, shown at once (standard prompts)     fit their favourites? the rest is dropped
        │                                              │
        ◄──────────────────────────────────────────────┘
        ▼
the curator ── one review per moment, side by side: picks among the candidates for safety, era
        │      and culture, may leave a moment out, writes prompts (in their language too)
        ▼
the session, with reactions that feed the next one
```

## Does Qloo make a difference?

Encore and the same model on its own planned sessions for 24 people born 1932–1955 in the U.S. and abroad; every
pick was then looked up in Qloo ([eval/REPORT.md](eval/REPORT.md)).

| | Encore | Encore, Qloo only | Model without Qloo |
| --- | --- | --- | --- |
| Picks that resolve to a Qloo entity | 100% | 100% | 86% |
| Songs, films and TV from their teens and twenties | 99% | 99% | 94% |
| Roots abroad: films and TV made in that country | 70% | 68% | 70% |
| Roots abroad: films, TV and artists from that country | 64% | 57% | 54% |
| Distinct picks across all 24 people | 141 | 127 | 134 |
| Picks shared by three or more people | 0% | 2% | 2% |

One in seven of the model's own picks could not be found in Qloo at all, so it could not be shown, dated or
explained. The research step is what lifts home culture: stars like Cantinflas, Raj Kapoor and Aliki Vougiouklaki
that Qloo's taste signals alone did not surface. A first version of it pushed classics (*Singin' in the Rain* for five
people); asking it for what was particular to each person's place and roots fixed that.

## Privacy

Names, notes and session history stay in the browser (localStorage). To plan, Encore sends a birth year, hometown,
family roots, favourites and themes to avoid. Notes go to the writing assistant, so the form asks people to leave
out names. Group sessions refer to people as "Person A", "Person B"; the browser puts the names back.

## Running it

```sh
npm install
cp .dev.vars.example .dev.vars   # QLOO_API_KEY, and optionally LLM_RELAY_URL / LLM_RELAY_KEY
npm run dev                      # http://localhost:5180
npm run typecheck
npm run deploy                   # Cloudflare Workers
```

Without the writing assistant configured, Encore still plans every session from Qloo and uses standard prompts.

The curator and Ask Encore run on a model reached through a small relay (`relay/`), installed on the maintainer's
machine with `scripts/install-relay.sh`. The relay listens on localhost only, runs under a macOS sandbox, accepts
requests that carry a shared key, caps calls per minute and stops on a set date.

## Stack

Cloudflare Workers (API, static assets, rate limiting), React and Vite, TypeScript. No database: people and
sessions live in the browser; Qloo answers and model outputs are cached at the edge.

The Workers free plan allows about 10 ms of CPU per invocation, and much of that goes on waking up for each
answer or event. So a session is spread across invocations: each Qloo answer is fetched and trimmed in one
(`QlooProxy`), and each pool, each research check and each model call runs in another (`Planner`). The session
itself runs in two more, one for Qloo's plan and one for the research check and the curator. Both write straight
into the response stream, so the request that streams the session only passes the stream on.

## Notes

Encore is a planning aid for caregivers and activity staff. It is not a medical device and does not give medical
advice.

License: [MIT](LICENSE)
