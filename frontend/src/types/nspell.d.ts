declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean
    suggest(word: string): string[]
    add(word: string): this
    remove(word: string): this
    personal(dic: string): this
  }
  function nspell(aff: string | Uint8Array, dic?: string | Uint8Array): NSpell
  function nspell(dict: { aff: string | Uint8Array; dic: string | Uint8Array }): NSpell
  export = nspell
}
