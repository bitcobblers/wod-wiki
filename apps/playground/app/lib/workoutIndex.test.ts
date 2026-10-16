import { describe, expect, it } from 'bun:test'
import { buildWorkoutItems, deriveDate } from './workoutIndex'

const ZOMBIE_WOD = `---
date: 2009-12-01
original_url: "http://zombiefit.org/2009/11/wod-120109/"
format: intervals
---
# WOD
`

const NO_DATE = `---
format: for-time
---
# WOD
`

describe('deriveDate', () => {
  it('parses YYYY-MM-DD to noon-UTC epoch ms', () => {
    expect(deriveDate(ZOMBIE_WOD)).toBe(new Date('2009-12-01T12:00:00Z').getTime())
  })

  it('returns undefined when date is missing or malformed', () => {
    expect(deriveDate(NO_DATE)).toBeUndefined()
    expect(deriveDate('---\ndate: December 1, 2009\n---\n')).toBeUndefined()
    expect(deriveDate('---\ndate: 2009-02-30\n---\n')).toBeUndefined() // impossible calendar day, never NaN
  })
})

describe('buildWorkoutItems', () => {
  it('carries frontmatter date onto the WorkoutItem', () => {
    const [item] = buildWorkoutItems({
      'markdown/collections/zombiefit/2009-12-01.md': ZOMBIE_WOD,
    })
    expect(item!.date).toBe(new Date('2009-12-01T12:00:00Z').getTime())
    expect(item!.category).toBe('zombiefit')
  })

  it('leaves date undefined for undated files', () => {
    const [item] = buildWorkoutItems({ 'markdown/collections/crossfit-girls/fran.md': NO_DATE })
    expect(item!.date).toBeUndefined()
  })

  it('humanizes displayName while keeping name as routing identity', () => {
    const files = {
      'markdown/collections/swimming-triathlete/half-ironman-70-3-building.md': NO_DATE,
      'markdown/collections/zombiefit/jerk-technique-and-endurance.md': NO_DATE,
    }
    const items = Object.fromEntries(
      buildWorkoutItems(files).map(i => [i.name, i]),
    )
    expect(items['half-ironman-70-3-building']!.displayName).toBe('Half Ironman 70.3 Building')
    expect(items['jerk-technique-and-endurance']!.displayName).toBe('Jerk Technique and Endurance')
  })

  it('prefers frontmatter title: over the humanized filename', () => {
    const [item] = buildWorkoutItems({
      'markdown/collections/swimming-post-college/international-im-preparation.md':
        '---\ntitle: International IM Preparation\n---\n# IM\n',
    })
    expect(item!.name).toBe('international-im-preparation')
    expect(item!.displayName).toBe('International IM Preparation')
  })
})
