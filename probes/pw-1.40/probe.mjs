import { createRequire } from 'node:module'
import { webkit } from 'playwright'

import { runProbe } from '../../lib/run-probe.mjs'

const require = createRequire(import.meta.url)
await runProbe(webkit, require('playwright/package.json').version)
