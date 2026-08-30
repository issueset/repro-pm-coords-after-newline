import { build } from 'esbuild'

await build({ entryPoints: ['main.js'], bundle: true, outfile: 'dist/bundle.js' })
