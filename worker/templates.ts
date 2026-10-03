// Conversation prompts that work without a language model.
// Reminiscence practice: invite stories, never test memory ("Do you remember...?" is avoided).

import type { Item } from '../shared/types'

export interface PromptContext {
  birthYear: number
  hometown?: string
}

function ageAt(item: Item, ctx: PromptContext): number | undefined {
  return item.year ? item.year - ctx.birthYear : undefined
}

function place(ctx: PromptContext): string {
  return ctx.hometown ? ctx.hometown.split(',')[0] : 'your hometown'
}

export function templatePrompts(item: Item, ctx: PromptContext): { prompts: string[]; sensory: string } {
  const age = ageAt(item, ctx)
  const home = place(ctx)
  switch (item.domain) {
    case 'music':
      return {
        prompts: [
          `This is ${item.name}${item.feature ? ` singing "${item.feature}"` : ''}. What does this song make you think of?`,
          'Where did you used to hear music like this: the radio, a dance hall, a jukebox?',
          'Who did you like to dance with?',
        ],
        sensory: 'Tap the rhythm together, or offer a hand if they want to sway.',
      }
    case 'film':
      return {
        prompts: [
          `${item.name} came out in ${item.year ?? 'those years'}${age && age > 0 ? `, when you were about ${age}` : ''}. Tell me about going to the movies back then.`,
          `What was the movie theater like in ${home}?`,
          'Who were the stars everyone talked about?',
        ],
        sensory: 'Dim the lights for the trailer. A bag of popcorn helps.',
      }
    case 'tv':
      return {
        prompts: [
          `${item.name} was on TV from ${item.year ?? 'those years'}. Who watched TV with you?`,
          'Where did the television sit in your home?',
          'What did your family eat or drink on TV nights?',
        ],
        sensory: 'Play the theme song first; many people hum along.',
      }
    case 'star':
      return {
        prompts: [
          `This is ${item.name}${item.feature ? `, known for ${item.feature}` : ''}. What do you think of them?`,
          'Who were the people everyone wanted to look or sound like?',
          'What did people wear when they went out?',
        ],
        sensory: 'Show a large photo and let them hold it.',
      }
    case 'place':
      return {
        prompts: [
          `This is ${item.name} in ${home}. Tell me about growing up near here.`,
          `What did a Saturday look like in ${home}?`,
          'Where did you go when you wanted something special to eat?',
        ],
        sensory: 'Look at the photo together on a big screen; let them point and lead.',
      }
  }
}
