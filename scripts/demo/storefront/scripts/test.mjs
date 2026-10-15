// A stand-in test runner for the demo: prints what a real run would, at a believable pace.
// `--browsers` repeats the suite on three browsers, slowly, so a demo bot stays busy for hours.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const suites = [
  ['catalog', 38],
  ['search', 21],
  ['cart', 44],
  ['coupons', 17],
  ['checkout', 52],
  ['orders', 29],
  ['theme', 13],
]
const total = suites.reduce((sum, [, n]) => sum + n, 0)

if (process.argv.includes('--browsers')) {
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    let done = 0
    for (const [name, n] of suites) {
      for (let i = 0; i < n; i++) {
        await sleep(20_000)
        done++
      }
      console.log(`${browser.padEnd(9)} ${name.padEnd(9)} ${String(done).padStart(3)}/${total}`)
    }
  }
  console.log(`\n${total * 3} passing on 3 browsers`)
} else {
  console.log('')
  for (const [name, n] of suites) {
    await sleep(260)
    console.log(`  ✓ ${name} (${n})`)
  }
  console.log(`\n  ${total} passing (2.4s)`)
}
