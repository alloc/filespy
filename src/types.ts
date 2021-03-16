import type { EventType, BackendType } from '@parcel/watcher'
import * as fs from 'fs'

export interface FileSpy {
  readonly cwd: string
  /**
   * Readonly set of currently watched directories.
   */
  readonly dirs: ReadonlySet<string>
  /**
   * Readonly sorted list of currently watched paths.
   */
  readonly files: readonly string[]
  /**
   * Readonly sorted list of existing paths that were skipped.
   */
  readonly skipped: readonly string[]

  on(
    event: 'create' | 'update',
    callback: (name: string, stats: fs.Stats, cwd: string) => void
  ): this

  on(event: 'delete', callback: (name: string, cwd: string) => void): this

  /** A directory has been crawled. */
  on(event: 'crawl', callback: (dir: string, cwd: string) => void): this

  /** The watcher is ready. */
  on(event: 'ready', callback: () => void): this

  /** Crawling failed or the watcher failed. */
  on(event: 'error', callback: (error: FileSpy.Error) => void): this

  on(
    event: 'all',
    callback: (
      event: EventType,
      name: string,
      stats: fs.Stats | null,
      cwd: string
    ) => void
  ): this

  close(): Promise<void>
}

export namespace FileSpy {
  export interface Options {
    /**
     * Emit only the files that match these Recrawl-style globs.
     *
     * https://www.npmjs.com/package/recrawl#pattern-syntax
     */
    only?: string[]
    /**
     * Avoid emitting files and crawling directories that match
     * these Recrawl-style globs.
     *
     * https://www.npmjs.com/package/recrawl#pattern-syntax
     */
    skip?: string[]
    /**
     * Choose a specific watcher backend.
     *
     * The available backends listed in priority order:
     * - `FSEvents` on macOS
     * - `Watchman` if installed
     * - `inotify` on Linux
     * - `ReadDirectoryChangesW` on Windows
     */
    backend?: BackendType
  }

  export type Error = AccessError | UnknownError

  interface AccessError extends GlobalError {
    code: 'EACCES'
    path: string
  }

  interface UnknownError extends GlobalError {
    code?: undefined
  }
}

type GlobalError = Error
