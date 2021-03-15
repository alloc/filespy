import { EventType, BackendType } from '@parcel/watcher'
import * as fs from 'fs'

export interface FileSpy {
  readonly cwd: string
  /**
   * Readonly set of directories being watched.
   */
  readonly dirs: ReadonlySet<string>
  /**
   * Readonly alphabetically-sorted list of watched files
   * and directories (relative to `cwd`) that is updated
   * as files and directories are created/deleted.
   */
  readonly files: readonly string[]
  /**
   * Readonly unsorted array of ignored files and directories.
   */
  readonly ignored: readonly string[]

  on(
    event: 'create' | 'update',
    callback: (name: string, stats: fs.Stats, cwd: string) => void
  ): this

  on(event: 'delete', callback: (name: string, cwd: string) => void): this

  /** The initial crawl is done and the watcher is active. */
  on(event: 'ready', callback: () => void): this

  /** Crawling failed or the watcher failed. */
  on(event: 'error', callback: (error: Error) => void): this

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
}
