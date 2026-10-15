/**
 * What a Mermaid diagram is, in words, for the quiet tile that stands for it in the chat. Pure.
 */

const KINDS: [RegExp, string][] = [
  [/^(?:graph|flowchart)\b/i, 'Flowchart'],
  [/^sequenceDiagram\b/i, 'Sequence diagram'],
  [/^classDiagram\b/i, 'Class diagram'],
  [/^stateDiagram(?:-v2)?\b/i, 'State diagram'],
  [/^erDiagram\b/i, 'ER diagram'],
  [/^gantt\b/i, 'Gantt chart'],
  [/^pie\b/i, 'Pie chart'],
  [/^journey\b/i, 'User journey'],
  [/^mindmap\b/i, 'Mind map'],
  [/^timeline\b/i, 'Timeline'],
  [/^gitGraph\b/i, 'Git graph'],
  [/^quadrantChart\b/i, 'Quadrant chart'],
  [/^xychart(?:-beta)?\b/i, 'Chart'],
  [/^sankey(?:-beta)?\b/i, 'Sankey diagram'],
  [/^block(?:-beta)?\b/i, 'Block diagram'],
  [/^architecture(?:-beta)?\b/i, 'Architecture diagram'],
  [/^requirementDiagram\b/i, 'Requirement diagram'],
  [/^C4(?:Context|Container|Component|Dynamic|Deployment)\b/, 'C4 diagram'],
]

/** "Flowchart", "Sequence diagram"…, from the first line of the source (after any `---` front matter and `%%` comment lines); "Diagram" when unknown. */
export function diagramKind(source: string): string {
  const lines = source.split('\n')
  let at = 0

  // Front matter: a block between two `---` lines at the top.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')

    at = end > 0 ? end + 1 : 0
  }

  const first = lines.slice(at).map(line => line.trim()).find(line => line && !line.startsWith('%%'))

  return KINDS.find(([pattern]) => first !== undefined && pattern.test(first))?.[1] ?? 'Diagram'
}
