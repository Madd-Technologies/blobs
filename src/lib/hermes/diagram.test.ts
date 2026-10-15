import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { diagramKind } from './diagram.ts'

describe('diagramKind', () => {
  it('names the common diagrams from their first word', () => {
    assert.equal(diagramKind('graph TD\n  A-->B'), 'Flowchart')
    assert.equal(diagramKind('flowchart LR\n A-->B'), 'Flowchart')
    assert.equal(diagramKind('sequenceDiagram\n  A->>B: hi'), 'Sequence diagram')
    assert.equal(diagramKind('classDiagram\n  A <|-- B'), 'Class diagram')
    assert.equal(diagramKind('stateDiagram-v2\n  [*] --> A'), 'State diagram')
    assert.equal(diagramKind('erDiagram\n  A ||--o{ B : has'), 'ER diagram')
    assert.equal(diagramKind('gantt\n  title X'), 'Gantt chart')
    assert.equal(diagramKind('pie title Pets\n  "Dogs" : 3'), 'Pie chart')
    assert.equal(diagramKind('mindmap\n  root'), 'Mind map')
  })

  it('skips front matter, comments and blank lines before the first word', () => {
    assert.equal(diagramKind('---\ntitle: Plan\n---\nflowchart TD\n A-->B'), 'Flowchart')
    assert.equal(diagramKind('%% a note\n\n  sequenceDiagram\n A->>B: x'), 'Sequence diagram')
  })

  it('says "Diagram" for anything else, and for nothing', () => {
    assert.equal(diagramKind('somethingNew\n x'), 'Diagram')
    assert.equal(diagramKind(''), 'Diagram')
    assert.equal(diagramKind('---\ntitle: never closed'), 'Diagram')
  })
})
