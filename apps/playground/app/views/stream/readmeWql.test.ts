import { describe, it, expect } from 'bun:test'
import { splitReadmeQueries, hasReadmeQuery } from './readmeWql'

describe('splitReadmeQueries', () => {
  it('returns the whole prose as one markdown segment with no embeds', () => {
    expect(splitReadmeQueries('# Hello\n\nSome **readme** text.')).toEqual([
      { kind: 'markdown', text: '# Hello\n\nSome **readme** text.' },
    ])
  })

  it('extracts a bang link as an embed with its label as the heading', () => {
    const segments = splitReadmeQueries('Intro.\n\n[Recent WODs](:feeds{notebook:crossfit-girls} by {tag})!\n\nOutro.')
    expect(segments).toEqual([
      { kind: 'markdown', text: 'Intro.\n\n' },
      { kind: 'query', query: ':feeds{notebook:crossfit-girls} by {tag}', heading: 'Recent WODs' },
      { kind: 'markdown', text: '\n\nOutro.' },
    ])
  })

  it('decodes percent-encoded spaces in the destination', () => {
    const segments = splitReadmeQueries('[Girls](:feeds{notebook:girls}%20by%20{date})!')
    expect(segments).toEqual([
      { kind: 'query', query: ':feeds{notebook:girls} by {date}', heading: 'Girls' },
    ])
  })

  it('migrates a legacy catalog: filter to notebook: (ticket 08)', () => {
    const segments = splitReadmeQueries('[Recent](:feed{catalog:crossfit-girls} by {tag})!')
    expect(segments).toEqual([
      { kind: 'query', query: ':feed{notebook:crossfit-girls} by {tag}', heading: 'Recent' },
    ])
  })

  it('supports an empty heading and multiple embeds on one page', () => {
    const segments = splitReadmeQueries('[](:feeds{notebook:a})!\nmid\n[](:effort{discipline:strength})!')
    expect(segments).toEqual([
      { kind: 'query', query: ':feeds{notebook:a}', heading: '' },
      { kind: 'markdown', text: '\nmid\n' },
      { kind: 'query', query: ':effort{discipline:strength}', heading: '' },
    ])
  })

  it('leaves a bang-less WQL link as markdown (plain navigation link)', () => {
    const prose = 'See [all feeds](:feed{catalog:a}).'
    expect(splitReadmeQueries(prose)).toEqual([{ kind: 'markdown', text: prose }])
  })

  it('passes embed-shaped links with invalid WQL through as markdown', () => {
    const prose = '[broken](:nonsense{})!'
    expect(splitReadmeQueries(prose)).toEqual([{ kind: 'markdown', text: prose }])
  })

  it('keeps the markdown between two embeds', () => {
    const segments = splitReadmeQueries('[](:feeds{notebook:a})!\n[](:feeds{notebook:b})!')
    expect(segments).toEqual([
      { kind: 'query', query: ':feeds{notebook:a}', heading: '' },
      { kind: 'markdown', text: '\n' },
      { kind: 'query', query: ':feeds{notebook:b}', heading: '' },
    ])
  })
})

describe('hasReadmeQuery', () => {
  it('is false for plain markdown and true once an embed exists', () => {
    expect(hasReadmeQuery(splitReadmeQueries('# Readme'))).toBe(false)
    expect(hasReadmeQuery(splitReadmeQueries('[](:feed{})!'))).toBe(true)
  })
})
