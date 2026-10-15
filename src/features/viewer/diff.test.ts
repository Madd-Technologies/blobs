import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { diffStat, parseDiff } from './diff.ts'

const DIFF = `--- a/skills/doc-search/SKILL.md
+++ b/skills/doc-search/SKILL.md
@@ -3,4 +3,5 @@ name: doc-search
 version: 1.1.0
-Search with query=
+Search with title__icontains=
+Fall back to the recent list.
 Download the hit.
\\ No newline at end of file
`

describe('a unified diff as lines', () => {
  it('names the file, marks the hunk, and numbers both sides', () => {
    assert.deepEqual(parseDiff(DIFF), [
      { kind: 'file', text: 'skills/doc-search/SKILL.md' },
      { kind: 'hunk', text: 'name: doc-search' },
      { kind: 'context', text: 'version: 1.1.0', old: 3, new: 3 },
      { kind: 'remove', text: 'Search with query=', old: 4 },
      { kind: 'add', text: 'Search with title__icontains=', new: 4 },
      { kind: 'add', text: 'Fall back to the recent list.', new: 5 },
      { kind: 'context', text: 'Download the hit.', old: 5, new: 6 },
    ])
  })

  it('counts what it adds and removes', () => {
    assert.deepEqual(diffStat(parseDiff(DIFF)), { added: 2, removed: 1 })
  })

  it('names a new file by its new path', () => {
    assert.equal(parseDiff('--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hi\n')[0]?.text, 'new.txt')
  })
})
