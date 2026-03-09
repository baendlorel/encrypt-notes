// @ts-check
// plugins
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import funcMacro from 'rollup-plugin-func-macro';
import constEnum from 'rollup-plugin-const-enum';
import conditional from 'rollup-plugin-conditional-compilation';

// # common options

/**
 * build config
 */
const tsconfig = './tsconfig.build.json';

// # main options

const IS_DEV = process.env.NODE_ENV === 'dev';

/**
 * @type {import('rollup').RollupOptions[]}
 */
const options = [
  {
    input: 'src/extension.ts',
    output: [
      {
        file: 'out/extension.js',
        format: 'cjs',
        sourcemap: IS_DEV,
        globals: {
          vscode: 'vscode',
        },
      },
    ],

    plugins: [
      funcMacro(),
      constEnum(),
      resolve(),
      commonjs(),
      typescript({ tsconfig, removeComments: false }),
      conditional({ variables: { DEBUG: IS_DEV } }),
      IS_DEV
        ? null
        : terser({
            format: {
              comments: false,
            },
            compress: {
              reduce_vars: true,
              drop_console: true,
              dead_code: true, // ✅ Safe: remove dead code
              evaluate: true, // ✅ Safe: evaluate constant expressions
            },
            mangle: {
              properties: {
                regex: /^_/, // only mangle properties starting with '_'
              },
            },
          }),
    ].filter(Boolean),
    external: ['vscode'],
  },
];

export default options;
