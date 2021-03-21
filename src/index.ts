import {
  subscribe as watch,
  AsyncSubscription as Watcher,
  Event,
} from '@parcel/watcher'
import { waitForPath, WaitForPathResult } from 'wait-for-path'
import { dirname, resolve } from 'path'
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

const CREATE = 'create'
const UPDATE = 'update'
const DELETE = 'delete'

export { FileSpy }

export function filespy(cwd: string, opts: FileSpy.Options = {}): FileSpy {
  cwd = slash(resolve(cwd)).replace(/\/$/, '')

  const only = createMatcher(opts.only) || alwaysTrue
  const skip = createMatcher(opts.skip) || alwaysFalse
  const dirs = new Set<string>()
  const files: string[] = []
  const skipped: string[] = []
  const emitter = new EventEmitter()
  const emit = wrapEmit((event, args) => {
    emitter.emit(event, ...args)
    if (event == CREATE || event == UPDATE || event == DELETE) {
      event == DELETE && args.splice(1, 0, null)
      emitter.emit('all', event, ...args)
    }
  })

  let closed = false
  let waiting: WaitForPathResult | undefined
  let watching: Promise<Watcher | undefined> | undefined

  // Wait for listeners to be attached.
  setImmediate(() => {
    if (closed) return
    waiting = waitForPath(cwd)
    waiting
      .then(() => {
        watching = crawl('').then(async () => {
          if (closed) return
          const watcher = await watch(cwd, processEvents, {
            backend: opts.backend,
            ignore: skipped,
          })

          emit('ready')
          return watcher
        })
        return watching
      })
      .catch(onError)
  })

  function onError(err: FileSpy.Error) {
    if (err.code == 'EACCES') {
      const file = err.path.slice(cwd.length + 1)
      addSkipped(file)
      if (dirs.has(file)) {
        removeDir(file)
      }
    }
    emit('error', err)
    return undefined
  }

  // Promise may reject for permission error.
  async function crawl(dir: string): Promise<any> {
    const children = await fsp.readdir(join(cwd, dir))
    await Promise.all(
      children.map(name => {
        const file = join(dir, name)
        return skip(file, name)
          ? addSkipped(file)
          : addPath(file, name).catch(onError)
      })
    )
    emit('crawl', dir, cwd)
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
      addSkipped(file)
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
        addSkipped(file)
      }
    } catch (err) {
      onError(err)
    }
  }

  function addFile(file: string, stats: fs.Stats) {
    binaryInsert(files, file, sortPaths)
    emit(CREATE, file, stats, cwd)
  }

  // Promise may reject for permission error.
  function addDir(dir: string) {
    dirs.add(dir)
    binaryInsert(files, dir, sortPaths)
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
      emit(DELETE, file, cwd)
    }

    files.splice(fromIndex, i - fromIndex)
    dirs.delete(dir)
  }

  function addSkipped(path: string) {
    binaryInsert(skipped, path, sortPaths)
  }

  function removeSkipped(path: string, recursive?: boolean) {
    const fromIndex = skipped.indexOf(path)
    if (fromIndex >= 0) {
      let i = fromIndex
      if (recursive)
        while (++i < skipped.length && isDescendant(skipped[i], path)) {}
      else i++

      skipped.splice(fromIndex, i - fromIndex)
    }
  }

  function processEvents(err: Error | null, events: Event[]) {
    if (err) {
      return onError(err)
    }
    const dirQueue = new Set<string>()
    eventLoop: for (let i = 0; i < events.length; i++) {
      const { type, path } = events[i]
      const file = slash(path).slice(cwd.length + 1)
      if (skip(file)) {
        // If the file's directory was skipped *after* the watcher was created,
        // the file still gets added to `skipped` but it's whatever.
        if (type == CREATE) {
          addSkipped(file)
        } else if (type == DELETE) {
          removeSkipped(file, true)
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
          emit(UPDATE, file, stats, cwd)
        } else {
          emit(DELETE, file, cwd)
        }
      } else if (type == DELETE) {
        removeSkipped(file)
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
    skipped,
    on(event: string, callback: any) {
      emitter.on(event, callback)
      return this
    },
    list(dir) {
      const fromIndex = files.indexOf(dir) + 1
      if (fromIndex > 0) {
        let i = fromIndex
        while (i < files.length && isDescendant(files[i], dir)) {
          i += 1
        }
        return files.slice(fromIndex, i)
      }
      return []
    },
    async close() {
      closed = true
      waiting?.close()
      return watching?.then(watcher => {
        watcher?.unsubscribe()
      })
    },
  }
}

function isDescendant(file: string, dir: string) {
  return file[dir.length] == '/' && dir == file.slice(0, dir.length)
}

function join(parent: string, child: string) {
  return parent ? parent + '/' + child : child
}

type QueuedEmit = [event: string, args: any[]] | null

function wrapEmit(emitSync: (event: string, args: any[]) => void) {
  // Skip event filtering during the initial crawl.
  let crawling = true

  // Pretend to be processing until the "ready" event.
  let processing = true

  // The queue is reset whenever fully processed.
  let queue: QueuedEmit[] = []

  return (event: string, ...args: any[]) => {
    const [file, stats, cwd] = args
    if (!crawling) {
      // Try to cancel out a "delete" event.
      if (event == CREATE) {
        const index = queue.findIndex(
          e => e && e[0] == DELETE && e[1][0] == file
        )
        if (~index) {
          queue[index] = null
          event = UPDATE
          args = [file, stats, cwd]
        }
      }

      // Try to update a "create" or "update" event.
      else if (event == UPDATE) {
        const index = queue.findIndex(
          e => e && (e[0] == CREATE || e[0] == UPDATE) && e[1][0] == file
        )
        if (~index) {
          queue[index]![1][1] = stats
          return
        }
      }

      // Try to cancel out a "create" or "update" event.
      else if (event == DELETE) {
        const index = queue.findIndex(
          e => e && (e[0] == CREATE || e[0] == UPDATE) && e[1][0] == file
        )
        if (~index) {
          const [event] = queue[index]!
          queue[index] = null
          if (event == CREATE) {
            return // Skip "delete" event since "create" was never handled.
          }
        }
      }

      // Process crawl events now that the watcher is ready.
      else if (event == 'ready') {
        processing = false
      }
    }

    // Enable event filtering once the root directory is crawled.
    else if (event == 'crawl') {
      if (!file) {
        crawling = false
      }
    }

    // Listeners may be blocking us, or the watcher is initializing.
    queue.push([event, args])
    if (!processing) {
      processing = true
      setImmediate(() => {
        processEmits(0)
      })
    }
  }

  function processEmits(i: number) {
    let elapsed = 0
    for (let e: QueuedEmit; i < queue.length && elapsed < 100; i++) {
      if ((e = queue[i])) {
        queue[i] = null
        const start = Date.now()
        try {
          emitSync(...e)
        } catch (e) {
          process.emit('uncaughtException', e)
        }
        elapsed += Date.now() - start
      }
    }
    if (i < queue.length) {
      setImmediate(() => {
        processEmits(i)
      })
    } else {
      queue = []
      processing = false
    }
  }
}
