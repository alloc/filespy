import * as path from 'path'
import globRegex from 'glob-regex'

/** Tests true for absolute paths and globs starting with two asterisks. */
const globAllRE = new RegExp(`(?:\\${path.sep}|\\*\\*)`)

/** Merge regular expressions together. */
const matchAny = (patterns: string[]) =>
  new RegExp(`^(?:${patterns.join('|')})$`)

/** Provide the `name` argument to avoid unnecessary `path.basename` calls */
export type GlobMatcher = (file: string, name?: string) => boolean

/**
 * Compile a single Recrawl glob string into its "RegExp pattern" equivalent.
 *
 * Note: This is only useful for globs with "/" or "**" in them.
 */
export function compileGlob(glob: string, root?: string) {
  if (glob[0] == path.sep) {
    glob = glob.slice(1)
  } else if (glob[0] !== '*') {
    glob = '**/' + glob
  }
  if (glob.endsWith('/')) {
    glob += '**'
  }
  if (root) glob = path.join(root, glob)
  return globRegex.replace(glob)
}

/**
 * Create a function that tests against an array of Recrawl glob strings by
 * compiling them into RegExp objects.
 */
export function createMatcher(
  globs: string[] | undefined,
  root?: string
): GlobMatcher | null {
  if (!globs || !globs.length) {
    return null
  }
  const fileGlobs: string[] = []
  const nameGlobs: string[] = []
  globs.forEach(glob => {
    if (globAllRE.test(glob)) {
      fileGlobs.push(compileGlob(glob, root))
    } else {
      nameGlobs.push(globRegex.replace(glob))
    }
  })
  const fileRE = fileGlobs.length ? matchAny(fileGlobs) : false
  const nameRE = nameGlobs.length ? matchAny(nameGlobs) : false
  return (file, name) =>
    (nameRE && nameRE.test(name || path.basename(file))) ||
    (fileRE && fileRE.test(file))
}
