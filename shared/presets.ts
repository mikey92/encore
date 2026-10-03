// Qloo tag IDs used across the app. Found with /v2/tags.

/** Themes a caregiver can switch off. Each maps to the genre, theme and keyword tags Qloo uses. */
export const AVOID_PRESETS: Record<string, { label: string; tags: string[] }> = {
  war: {
    label: 'War',
    tags: ['urn:tag:genre:media:war', 'urn:tag:theme:qloo:war', 'urn:tag:keyword:qloo:war', 'urn:tag:subgenre:qloo:war'],
  },
  death: {
    label: 'Death and loss',
    tags: ['urn:tag:genre:media:death', 'urn:tag:theme:qloo:death', 'urn:tag:keyword:qloo:death'],
  },
  violence: {
    label: 'Violence',
    tags: ['urn:tag:keyword:qloo:violence', 'urn:tag:theme:qloo:violence'],
  },
  horror: {
    label: 'Horror',
    tags: ['urn:tag:genre:media:horror', 'urn:tag:keyword:qloo:horror', 'urn:tag:theme:qloo:horror'],
  },
}

export const LANDMARK_TAGS = ['urn:tag:category:place:landmark', 'urn:tag:category:place:tourist_attraction']

/** Film genres for the this-or-that interview, in the order they are paired. */
export const FILM_PROBES: { tag: string; label: string }[] = [
  { tag: 'urn:tag:genre:media:musical', label: 'Musicals' },
  { tag: 'urn:tag:genre:media:western', label: 'Westerns' },
  { tag: 'urn:tag:genre:media:romance', label: 'Romance' },
  { tag: 'urn:tag:genre:media:comedy', label: 'Comedy' },
  { tag: 'urn:tag:genre:media:adventure', label: 'Adventure' },
  { tag: 'urn:tag:genre:media:family', label: 'Family films' },
]

/** Music styles for the this-or-that interview, paired so each question splits tastes. */
export const MUSIC_PROBES: { tag: string; label: string; from: number; to: number }[] = [
  { tag: 'urn:tag:genre:music:big_band', label: 'Big band', from: 1930, to: 1955 },
  { tag: 'urn:tag:genre:music:traditional_pop', label: 'Crooners', from: 1940, to: 1970 },
  { tag: 'urn:tag:genre:music:rock', label: 'Rock and roll', from: 1954, to: 1990 },
  { tag: 'urn:tag:genre:music:classic_country', label: 'Country', from: 1940, to: 1990 },
  { tag: 'urn:tag:genre:music:motown', label: 'Motown', from: 1959, to: 1985 },
  { tag: 'urn:tag:genre:music:doo_wop', label: 'Doo-wop', from: 1950, to: 1965 },
  { tag: 'urn:tag:genre:music:gospel', label: 'Gospel', from: 1930, to: 1990 },
  { tag: 'urn:tag:genre:music:bolero', label: 'Boleros', from: 1930, to: 1980 },
  { tag: 'urn:tag:genre:music:ranchera', label: 'Rancheras', from: 1930, to: 1990 },
  { tag: 'urn:tag:genre:music:trot', label: 'Trot', from: 1930, to: 1995 },
]
