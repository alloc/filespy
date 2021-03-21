import { FileSpy, filespy } from 'filespy'
import * as path from 'path'
import { dequal } from 'dequal'
import delay from 'delay'
import exec = require('@cush/exec')
import isWindows = require('is-windows')
import fs = require('saxon/sync')

const throttleDelay = process.env.CI ? 200 : 100

const cwd = path.resolve(__dirname, '__fixtures__')
process.chdir(cwd)

let spy: FileSpy

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

    it('emits "crawl" once per directory', async () => {
      const listener = jest.fn()
      spy = filespy(cwd).on('crawl', dir => {
        listener('crawl', dir)
      })

      await getReadyPromise(spy)
      expectEvents(listener, [
        ['crawl', 'foo/bar/baz'],
        ['crawl', 'foo/bar'],
        ['crawl', 'foo'],
        ['crawl', ''],
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

    it('tracks skipped paths', async () => {
      spy = filespy(cwd, {
        only: ['*.ts'],
        skip: ['bar.ts', 'baz'],
      })
      await getReadyPromise(spy)
      expect(spy.skipped).toMatchInlineSnapshot(`
        Array [
          "foo/bar/baz",
          "foo/bar/index.js",
          "foo/bar.ts",
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
      spy.on('crawl', dir => listener('crawl', dir))

      addDir('test', ['a'])
      addDir('test2', [])
      addFile('test/b')
      await delay(throttleDelay)

      expectEvents(listener, [
        ['crawl', 'test2'],
        ['create', 'test/a'],
        ['create', 'test/b'],
        ['crawl', 'test'],
      ])
    })

    it('crawls renamed directories', async () => {
      spy = filespy(cwd)
      await getReadyPromise(spy)
      addDir('test', ['a', 'b'])

      await delay(throttleDelay)
      const listener = jest.fn()
      spy.on('all', listener)
      spy.on('crawl', dir => listener('crawl', dir))

      fs.rename('test', 'test2')

      await delay(throttleDelay)
      expectEvents(listener, [
        ['delete', 'test/a'],
        ['delete', 'test/b'],
        ['create', 'test2/a'],
        ['create', 'test2/b'],
        ['crawl', 'test2'],
      ])
    })

    it('ignores skipped directories', async () => {
      spy = filespy(cwd, { skip: ['test', 'bar'] })
      await getReadyPromise(spy)

      const listener = jest.fn()
      spy.on('all', listener)

      // Add a file whose directory was skipped *before* watcher init.
      addFile('foo/bar/a')

      // Add a skipped directory.
      addDir('test', ['a'])

      await delay(throttleDelay)
      expectEvents(listener, [])

      // Add a file whose directory was skipped *after* watcher init.
      addFile('test/b')

      await delay(throttleDelay)
      expectEvents(listener, [])
    })

    it('ignores skipped files', async () => {
      spy = filespy(cwd, { skip: ['*.md'] })
      await getReadyPromise(spy)

      const listener = jest.fn()
      spy.on('all', listener)

      addFile('a.md')
      addFile('b.js')

      await delay(throttleDelay)
      expectEvents(listener, [['create', 'b.js']])
    })

    describe('when skipped file is deleted', () => {
      it('cleans up the "skipped" array', async () => {
        spy = filespy(cwd, {
          only: ['/foo/bar/'],
          skip: ['*.js'],
        })
        await getReadyPromise(spy)

        // Add a file skipped by "skip" globs.
        addFile('foo/bar/foo.js')
        // Add a file skipped by "only" globs.
        addFile('foo/index.ts')

        // Remove a pre-crawl file skipped by "skip" globs.
        fs.remove('foo/bar/index.js')
        // Remove a pre-crawl file skipped by "only" globs.
        fs.remove('foo/bar.ts')

        await delay(throttleDelay)

        // Remove post-crawl skipped files.
        fs.remove('foo/bar/foo.js')
        fs.remove('foo/index.ts')

        await delay(throttleDelay)

        expect(spy.skipped).not.toContain('foo/bar/foo.js')
        expect(spy.skipped).not.toContain('foo/index.ts')

        // Since these files were skipped on initial crawl,
        // we don't receive events for them, and so we can't
        // remove them from `skipped` when they're deleted.
        expect(spy.skipped).toContain('foo/bar/index.js')
        expect(spy.skipped).toContain('foo/bar.ts')
      })
    })
  })

  describe('list method', () => {
    it('works with watched directory', async () => {
      spy = filespy(cwd)
      await getReadyPromise(spy)

      expect(spy.list('foo/bar')).toMatchInlineSnapshot(`
        Array [
          "foo/bar/baz",
          "foo/bar/baz/index.ts",
          "foo/bar/index.js",
        ]
      `)
    })

    it('returns empty array for skipped path', async () => {
      spy = filespy(cwd, { skip: ['bar'] })
      await getReadyPromise(spy)

      expect(spy.list('foo/bar')).toEqual([])
    })

    it('returns empty array for non-existent path', async () => {
      spy = filespy(cwd)
      await getReadyPromise(spy)

      expect(spy.list('unknown')).toEqual([])
    })
  })

  describe('permission errors', () => {
    it('tolerates them', async () => {
      fs.mkdir('xxx/a', 0o333)
      fs.mkdir('xxx/b', 0o333)

      const errors: FileSpy.Error[] = []
      spy = filespy(cwd).on('error', e => errors.push(e))
      await getReadyPromise(spy, true)

      // Errors do not crash the crawler.
      expect(spy.files.length).toBeGreaterThan(0)

      if (isWindows()) {
        // TODO: reproduce permission error on Windows
        return expect(errors).toEqual([])
      }

      if (!errors.some(e => e.code)) {
        return expect(errors).not.toEqual(errors)
      }

      // Multiple permission errors can be emitted.
      expect(errors.map(e => e.code)).toMatchInlineSnapshot(`
          Array [
            "EACCES",
            "EACCES",
          ]
        `)

      // Related files are skipped.
      expect(spy.skipped).toMatchInlineSnapshot(`
          Array [
            "xxx/a",
            "xxx/b",
          ]
        `)
    })

    it('removes directory from "files" and "dirs"', async () => {
      fs.mkdir('xxx', 0o333)

      spy = filespy(cwd)
      await getReadyPromise(spy, true)

      expect(spy.files).not.toContain('xxx')
      expect(spy.dirs).not.toContain('xxx')
    })
  })
})

afterEach(async () => {
  await spy?.close()
  exec.sync('git clean -df __fixtures__', { cwd: __dirname })
  exec.sync('git checkout HEAD __fixtures__', { cwd: __dirname })
  return delay(throttleDelay)
})

function addDir(dir: string, children: string[], mode?: number) {
  fs.mkdir(dir, mode)
  children.forEach(file => {
    fs.write(path.join(dir, file), '')
  })
}

function addFile(file: string) {
  fs.write(file, '')
}

function getReadyPromise(spy: FileSpy, skipErrors?: boolean) {
  return new Promise<void>((resolve, reject) => {
    spy.on('ready', resolve)
    skipErrors || spy.on('error', reject)
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
