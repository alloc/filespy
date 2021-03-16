import {
  subscribe,
  getEventsSince,
  writeSnapshot,
  AsyncSubscription as Watcher,
  Event,
} from '@parcel/watcher'
import { dirname } from 'path'
import { EventEmitter } from 'events'
import { binaryInsert } from 'binary-insert'
import assert = require('assert')
import slash = require('slash')
import * as fs from 'fs'
import { createMatcher } from './glob'
import { sortPaths } from './sortPaths'
import type { FileSpy } from './types'

const fsp = fs.promises
const { S_IFMT, S_IFDIR } = fs.constants

const alwaysTrue = () => true
const alwaysFalse = () => false

const ALL = 'all'
const CREATE = 'create'
const UPDATE = 'update'
const DELETE = 'delete'

export { FileSpy }

export function filespy(cwd: string, opts: FileSpy.Options = {}): FileSpy {
  cwd = slash(cwd).replace(/\/$/, '')

  const only = createMatcher(opts.only) || alwaysTrue
  const skip = createMatcher(opts.skip) || alwaysFalse
  const dirs = new Set<string>()
  const files: string[] = []
  const ignored: string[] = []
  const emitter = new EventEmitter()

  const watcherOpts = {
    backend: opts.backend,
    ignore: ignored,
  }

  // Skip "create" events on initial crawl when a snapshot exists.
  let hasSnapshot = !!opts.snapshotPath && fs.existsSync(opts.snapshotPath)
  let skipMutation = false

  // Wait for listeners to be attached.
  let watching: Promise<Watcher | undefined>
  setImmediate(() => {
    watching = crawl('')
      .then(async () => {
        if (hasSnapshot) {
          hasSnapshot = false

          // Process events from after the last snapshot.
          const events = await getEventsSince(
            cwd,
            opts.snapshotPath!,
            watcherOpts
          )
          if (events.length) {
            skipMutation = true
            await processEvents(null, events)
            skipMutation = false
          }
        }

        // Start watching.
        return subscribe(cwd, processEvents, watcherOpts)
      })
      .then(watcher => {
        emitter.emit('ready')
        return watcher
      }, onError)
  })

  function onError(err: Error) {
    emitter.emit('error', err)
    return undefined
  }

  // Promise may reject for permission error.
  async function crawl(dir: string): Promise<any> {
    const children = await fsp.readdir(join(cwd, dir))
    return Promise.all(
      children.map(name => {
        const file = join(dir, name)
        return skip(file, name)
          ? addIgnored(file)
          : addPath(file, name).catch(onError)
      })
    )
  }

  // Promise may reject for permission error.
  async function addPath(file: string, name?: string) {
    const stats = await fsp.lstat(join(cwd, file))
    if ((stats.mode & S_IFMT) == S_IFDIR) {
      return addDir(file)
    }
    if (only(file, name)) {
      addFile(file, stats)
    } else {
      addIgnored(file)
    }
  }

  // Returns true for directories.
  function addPathSync(file: string) {
    // Protect against permission errors.
    try {
      const stats = fs.lstatSync(join(cwd, file))
      if ((stats.mode & S_IFMT) == S_IFDIR) {
        return true
      }
      if (only(file)) {
        addFile(file, stats)
      } else {
        addIgnored(file)
      }
    } catch (err) {
      onError(err)
    }
  }

  function addFile(file: string, stats: fs.Stats) {
    if (!skipMutation) {
      binaryInsert(files, file, sortPaths)
    }
    if (!hasSnapshot) {
      emitter.emit(CREATE, file, stats, cwd)
      emitter.emit(ALL, CREATE, file, stats, cwd)
    }
  }

  // Promise may reject for permission error.
  function addDir(dir: string) {
    if (!skipMutation) {
      dirs.add(dir)
      binaryInsert(files, dir, sortPaths)
    }
    return crawl(dir)
  }

  function removeDir(dir: string) {
    const fromIndex = files.indexOf(dir)
    assert(fromIndex >= 0)

    let i = fromIndex
    while (++i < files.length) {
      const file = files[i]
      if (!isDescendant(file, dir)) {
        break
      }
      emitter.emit(DELETE, file, cwd)
      emitter.emit(ALL, DELETE, file, null, cwd)
    }

    files.splice(fromIndex, i - fromIndex)
    dirs.delete(dir)
  }

  function addIgnored(path: string) {
    if (!skipMutation) {
      binaryInsert(ignored, path, sortPaths)
    }
  }

  function removeIgnored(path: string, recursive?: boolean) {
    const fromIndex = ignored.indexOf(path)
    if (fromIndex >= 0) {
      let i = fromIndex
      if (recursive)
        while (++i < ignored.length && isDescendant(ignored[i], path)) {}

      ignored.splice(fromIndex, i - fromIndex)
    }
  }

  function processEvents(err: Error | null, events: Event[]) {
    if (err) {
      return onError(err)
    }
    console.log(events)
    const dirQueue = new Set<string>()
    eventLoop: for (let i = 0; i < events.length; i++) {
      const { type, path } = events[i]
      const file = slash(path).slice(cwd.length + 1)
      if (skip(file)) {
        // If the file's directory was ignored *after* the watcher was created,
        // we still add it to the `ignored` array, but it's whatever.
        if (type == CREATE) {
          addIgnored(file)
        } else if (type == DELETE) {
          removeIgnored(file, true)
        }
        // The watcher ensures that events for descendants
        // of a directory come right after it.
        while (i + 1 < events.length) {
          if (isDescendant(events[i + 1].path, path)) {
            i += 1 // Skip this event since its directory got skipped.
          } else break
        }
        continue
      }
      let stats: fs.Stats | null = null
      if (type == CREATE) {
        let dir = dirname(file)
        if (dir == '.' || dirs.has(dir)) {
          if (addPathSync(file)) {
            // Crawl after events are processed.
            dirQueue.add((dir = file))

            // The watcher ensures that events for descendants of
            // this directory come right after it.
            while (i + 1 < events.length) {
              if (isDescendant(events[i + 1].path, path)) {
                i += 1 // Skip this event since its directory will be crawled.
              } else break
            }
          }
        } else {
          // Find the furthest ancestor not yet crawled.
          while (true) {
            if (skip(dir)) {
              continue eventLoop
            }
            const ancestor = dirname(dir)
            if (ancestor == '.' || dirs.has(ancestor)) break
            dir = ancestor
          }
          // Crawl after events are processed.
          dirQueue.add(dir)
        }
      } else if (dirs.has(file)) {
        if (type == DELETE) {
          removeDir(file)
        }
      } else if (only(file)) {
        if (type == UPDATE) {
          // Protect against permission errors.
          try {
            stats = fs.lstatSync(path)
          } catch (err) {
            onError(err)
            continue
          }
          emitter.emit(UPDATE, file, stats, cwd)
        } else {
          emitter.emit(DELETE, file, cwd)
        }
        emitter.emit(ALL, type, file, stats, cwd)
      } else if (type == DELETE) {
        removeIgnored(file)
      }
    }
    return Promise.all(
      Array.from(dirQueue, dir => {
        return addDir(dir).catch(onError)
      })
    )
  }

  return {
    cwd,
    dirs,
    files,
    ignored,
    on(event: string, callback: any) {
      emitter.on(event, callback)
      return this
    },
    close: (): any =>
      Promise.all([
        snapshot(cwd, opts.snapshotPath, watcherOpts),
        watching.then(watcher => {
          watcher?.unsubscribe()
        }),
      ]),
  }
}

async function snapshot(cwd: string, snapshotPath?: string, watcherOpts?: any) {
  if (snapshotPath) {
    fs.mkdirSync(dirname(snapshotPath), { recursive: true })
    await writeSnapshot(cwd, snapshotPath, watcherOpts)
  }
}

function isDescendant(file: string, dir: string) {
  return file[dir.length] == '/' && dir == file.slice(0, dir.length)
}

function join(parent: string, child: string) {
  return parent ? parent + '/' + child : child
}
