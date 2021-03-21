import dts from 'rollup-plugin-dts'
import esbuild from 'rollup-plugin-esbuild'
import nodeResolve from '@rollup/plugin-node-resolve'

const name = require('./package.json').main.replace(/\.js$/, '')

const bundle = config => ({
  ...config,
  input: 'src/index.ts',
  external: id => !/^[./]/.test(id) && id !== 'wait-for-path',
})

export default [
  bundle({
    plugins: [esbuild(), nodeResolve()],
    output: {
      file: `${name}.js`,
      format: 'cjs',
      sourcemap: true,
    },
  }),
  bundle({
    plugins: [dts(), nodeResolve()],
    output: {
      file: `${name}.d.ts`,
      format: 'es',
    },
  }),
]
