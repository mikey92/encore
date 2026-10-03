// Types shared by the Worker and the browser app.

export type Domain = 'music' | 'film' | 'tv' | 'star' | 'place'

/** A Qloo entity the person already loves (or reacted well to). */
export interface Seed {
  id: string
  name: string
  type: string
  weight?: number
  image?: string
  year?: number
}

/** What the browser sends. Names, notes and anything identifying stay on the device. */
export interface TasteRequest {
  birthYear: number
  hometown?: string
  heritage?: string[]
  favorites: Seed[]
  liked?: Seed[]
  avoidTags?: string[]
  avoidEntities?: string[]
  /** Items already used in earlier sessions; we prefer fresh ones. */
  used?: string[]
  /** The language they are most at home in, e.g. "Spanish". Prompts come in it too. */
  language?: string
  /** Free-text notes from family or staff, without names. */
  notes?: string
  /** Qloo tags that should steer suggestions, e.g. a holiday or a hobby */
  interestTags?: string[]
}

export interface Because {
  id: string
  name: string
  share: number
}

export interface Item {
  domain: Domain
  id: string
  name: string
  type: string
  year?: number
  /** Human-readable time, e.g. "1956–1988" for an artist or "born 1935" for a star */
  when?: string
  /** The year that places it in someone's life: release year, first record, or birth year for a star */
  era?: number
  image?: string
  /** e.g. the song to play, or the role the star is known for */
  feature?: string
  description?: string
  affinity?: number
  popularity?: number
  because: Because[]
  link?: string
  /** For staff: why this suits the person */
  why?: string
  prompts: string[]
  /** The same prompts in the person's own language, when it isn't English */
  promptsNative?: string[]
  sensory?: string
  tags: { id: string; name: string }[]
  /** Found by Qloo insights, or suggested by research and then grounded in Qloo */
  source?: 'research'
}

export interface TraceStep {
  tool: string
  detail: string
  count?: number
  ms?: number
}

export interface Slot {
  key: string
  title: string
  minutes: number
  item: Item
  alternates: Item[]
}

export interface Session {
  window: [number, number]
  slots: Slot[]
  trace: TraceStep[]
  narration: 'ai' | 'template'
  model?: string
  opening?: string
  closing?: string
  /** Candidates the curator left out, and why */
  skipped?: { id: string; name: string; reason: string }[]
  /** Group sessions: tastes the members share, and whose taste each slot serves. */
  commonGround?: { id: string; name: string }[]
  servedBy?: Record<string, number[]>
}

/** A change to a person's taste profile, proposed by Ask Encore from a caregiver's request. */
export interface Patch {
  addFavorites: Seed[]
  interestTags: { id: string; name: string }[]
  avoidTags: { id: string; name: string }[]
  avoidEntities: Seed[]
  note: string
  reply: string
}
