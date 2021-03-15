import { FileSpy, filespy } from 'filespy'
import * as path from 'path'
import { dequal } from 'dequal'
import delay from 'delay'
import fs = require('saxon/sync')

const cwd = path.resolve(__dirname, '__fixtures__')
process.chdir(cwd)

type Change =
  | { type: 'add'; file: string }
  | { type: 'rename'; oldPath: string; newPath: string }

let spy: FileSpy
let changes: Change[] = []

describe('filespy', () => {
  describe('initial crawl', () => {
    it('emits "create" once per file', async () => {
      const listener = jest.fn()
      spy = filespy(cwd).on('all', listener)

      await getReadyPromise(spy)
      expectEvents(listener, [
        ['create', 'foo/bar.ts'],
        ['create', 'foo/bar/index.js'],
        ['create', 'foo/bar/baz/index.ts'],
      ])
    })

    it('tracks directories', async () => {
      spy = filespy(cwd)
      await getReadyPromise(spy)
      expect(spy.dirs).toMatchInlineSnapshot(`
        Set {
          "foo",
          "foo/bar",
          "foo/bar/baz",
        }
      `)
    })

    it('tracks ignored paths', async () => {
      spy = filespy(cwd, {
        only: ['*.ts'],
        skip: ['bar.ts', 'baz'],
      })
      await getReadyPromise(spy)
      expect(spy.ignored).toMatchInlineSnapshot(`
        Array [
          "foo/bar.ts",
          "foo/bar/baz",
          "foo/bar/index.js",
        ]
      `)
    })
  })

  describe('watching', () => {
    it('crawls new directories', async () => {
      spy = filespy(cwd)
      await getReadyPromise(spy)

      const listener = jest.fn()
      spy.on('all', listener)

      addDir('test', ['a'])
      addDir('test2', [])
      addFile('test/b')
      await delay(100)

      expectEvents(listener, [
        ['create', 'test/a'],
        ['create', 'test/b'],
      ])
    })

    it('crawls renamed directories', async () => {
      spy = filespy(cwd)
      await getReadyPromise(spy)
      addDir('test', ['a', 'b'])

      await delay(100)
      const listener = jest.fn()
      spy.on('all', listener)

      rename('test', 'test2')

      await delay(100)
      expectEvents(listener, [
        ['delete', 'test/a'],
        ['delete', 'test/b'],
        ['create', 'test2/a'],
        ['create', 'test2/b'],
      ])
    })

    it('skips ignored directories', async () => {
      spy = filespy(cwd, { skip: ['test', 'bar'] })
      await getReadyPromise(spy)

      const listener = jest.fn()
      spy.on('all', listener)

      // Add a file whose directory was ignored *before* watcher init.
      addFile('foo/bar/a')

      // Add an ignored directory.
      addDir('test', ['a'])

      await delay(100)
      expectEvents(listener, [])

      // Add a file whose directory was ignored *after* watcher init.
      addFile('test/b')

      await delay(100)
      expectEvents(listener, [])
    })

    it('skips ignored files', async () => {
      spy = filespy(cwd, { skip: ['*.md'] })
      await getReadyPromise(spy)

      const listener = jest.fn()
      spy.on('all', listener)

      addFile('a.md')
      addFile('b.js')

      await delay(100)
      expectEvents(listener, [['create', 'b.js']])
    })
  })
})

afterEach(async () => {
  await spy?.close()
  changes.reverse().forEach(change => {
    if (change.type == 'add') {
      fs.remove(change.file, true)
    } else if (change.type == 'rename') {
      fs.rename(change.newPath, change.oldPath)
    }
  })
  changes.length = 0
  return delay(100)
})

function addDir(dir: string, children: string[]) {
  fs.mkdir(dir)
  changes.push({
    type: 'add',
    file: dir,
  })
  children.forEach(file => {
    fs.write(path.join(dir, file), '')
  })
}

function addFile(file: string) {
  fs.write(file, '')
  changes.push({
    type: 'add',
    file,
  })
}

function rename(oldPath: string, newPath: string) {
  fs.rename(oldPath, newPath)
  changes.push({
    type: 'rename',
    oldPath,
    newPath,
  })
}

function getReadyPromise(spy: FileSpy) {
  return new Promise<void>((resolve, reject) => {
    spy.on('ready', resolve).on('error', reject)
  })
}

function getEvents(mock: jest.Mock) {
  const events = mock.mock.calls.map(call => [...call].slice(0, 2))
  mock.mockClear()
  return events
}

function expectEvents(mock: jest.Mock, expected: any[]) {
  const actual = getEvents(mock)
  expect(actual).toEqual(resolveExpectedEvents(actual, expected))
}

// Order-agnostic deep value matching
function resolveExpectedEvents([...actual]: any[], expected: any[]) {
  const matched: any[] = []
  const unmatched: any[] = []

  // This symbol ensures values are never matched twice.
  const skip = Symbol()

  for (let i = 0; i < expected.length; i++) {
    const matchIndex = actual.findIndex(value => {
      return dequal(expected[i], value)
    })
    if (matchIndex >= 0) {
      matched[matchIndex] = actual[matchIndex]
      actual[matchIndex] = skip
    } else {
      unmatched.push(expected[i])
    }
  }

  return matched.concat(unmatched)
}
