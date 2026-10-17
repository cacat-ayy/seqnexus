import { describe, it, expect } from 'vitest'
import { ENZYME_GROUPS } from './db'
import { BUILT_IN_SUBSETS, DEFAULT_SUBSET, freeSetName, resolveEnzymeNames, sanitizeEnzymeSets, setForKey, setKey, subsetEnzymes, type EnzymeSet } from './sets'

const set = (id: string, name: string, enzymes: string[]): EnzymeSet => ({ id, name, enzymes, createdAt: 0 })

describe('subsetEnzymes', () => {
  it('reads a built-in subset from its enzyme group', () => {
    const names = subsetEnzymes('common6', []).map(e => e.name)
    expect(new Set(names)).toEqual(new Set(ENZYME_GROUPS['Common (6-cutters)']))
  })

  it('reads a saved set by its key, in the set\'s order', () => {
    const sets = [set('enzset_1', 'BioBrick', ['XbaI', 'EcoRI', 'PstI'])]
    expect(subsetEnzymes(setKey('enzset_1'), sets).map(e => e.name)).toEqual(['XbaI', 'EcoRI', 'PstI'])
    expect(setForKey(setKey('enzset_1'), sets)?.name).toBe('BioBrick')
  })

  it('falls back to the default subset for a set that no longer exists', () => {
    expect(subsetEnzymes(setKey('gone'), [])).toEqual(subsetEnzymes(DEFAULT_SUBSET, []))
    expect(BUILT_IN_SUBSETS.some(s => s.key === DEFAULT_SUBSET)).toBe(true)
  })
})

describe('resolveEnzymeNames', () => {
  it('spells names as the database does, each once, and lists the ones it does not know', () => {
    expect(resolveEnzymeNames(['ecori', 'EcoRI', ' BsaI ', 'Xyz9I', ''])).toEqual({ known: ['EcoRI', 'BsaI'], missing: ['Xyz9I'] })
  })
})

describe('freeSetName', () => {
  it('numbers a name another set already has', () => {
    const sets = [set('a', 'Type IIS', []), set('b', 'Type IIS 2', [])]
    expect(freeSetName('Type IIS', sets)).toBe('Type IIS 3')
    expect(freeSetName('type iis', sets)).toBe('type iis 3')
    expect(freeSetName('Type IIS', sets, 'a')).toBe('Type IIS')
    expect(freeSetName('  ', [])).toBe('Enzyme set')
  })
})

describe('sanitizeEnzymeSets', () => {
  it('keeps well-formed sets from a session and drops the rest', () => {
    expect(sanitizeEnzymeSets([
      { id: 'enzset_1', name: 'Mine', enzymes: ['EcoRI', 3], createdAt: 5 },
      { id: 'enzset_2', name: 7, enzymes: [] },
      'junk',
    ])).toEqual([{ id: 'enzset_1', name: 'Mine', enzymes: ['EcoRI'], createdAt: 5 }])
    expect(sanitizeEnzymeSets(undefined)).toEqual([])
  })
})
