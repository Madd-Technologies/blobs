// Removes build output and caches (the demo project has none worth keeping).
import { rmSync } from 'node:fs'

for (const dir of ['.cache', 'dist']) {
  rmSync(new URL(`../${dir}`, import.meta.url), { recursive: true, force: true })
  console.log(`removed ${dir}/`)
}
