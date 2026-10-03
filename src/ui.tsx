// Small shared pieces: routing, avatars, labels.

import { useEffect, useState } from 'react'
import type { Domain } from '../shared/types'

export function useRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const on = () => {
      setParts(read())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parts
}

export function go(path: string, replace = false) {
  if (replace) history.replaceState(null, '', `#${path}`)
  else location.hash = path
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'))
}

const COLORS = ['#6e3563', '#2f5f97', '#2f7a58', '#b97a1f', '#a2453b', '#4d5a8a', '#7a5a2f']

export function Avatar({ name, big }: { name: string; big?: boolean }) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (
    <div className={`avatar${big ? ' big' : ''}`} style={{ background: COLORS[h % COLORS.length] }} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  )
}

export const DOMAIN_ICON: Record<Domain, string> = { music: '🎵', film: '🎬', tv: '📺', star: '⭐', place: '🏛️' }

export function typeLabel(type?: string): string {
  switch (type) {
    case 'urn:entity:artist':
      return 'Music'
    case 'urn:entity:movie':
      return 'Film'
    case 'urn:entity:tv_show':
      return 'TV'
    case 'urn:entity:person':
      return 'Person'
    case 'urn:entity:place':
      return 'Place'
    default:
      return ''
  }
}

const VOICES: Record<string, string> = {
  english: 'en-US', spanish: 'es-US', portuguese: 'pt-PT', italian: 'it-IT', french: 'fr-FR', german: 'de-DE',
  greek: 'el-GR', polish: 'pl-PL', hindi: 'hi-IN', japanese: 'ja-JP', korean: 'ko-KR', chinese: 'zh-CN',
  mandarin: 'zh-CN', cantonese: 'zh-HK', vietnamese: 'vi-VN', tagalog: 'fil-PH', filipino: 'fil-PH', russian: 'ru-RU',
}

/** Reads text aloud in the person's language, for staff who don't speak it. Returns false if the browser can't. */
export function speak(lines: string[], language?: string): boolean {
  if (typeof speechSynthesis === 'undefined') return false
  speechSynthesis.cancel()
  const lang = VOICES[(language ?? 'english').trim().toLowerCase()] ?? 'en-US'
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').startsWith(lang.split('-')[0]))
  for (const line of lines) {
    const u = new SpeechSynthesisUtterance(line)
    u.lang = lang
    u.rate = 0.88
    if (voice) u.voice = voice
    speechSynthesis.speak(u)
  }
  return true
}

export function when(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function Img({ src, alt, fallback, className }: { src?: string; alt: string; fallback: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <div className={`blank ${className ?? ''}`}>{fallback}</div>
  return <img className={className} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
}
