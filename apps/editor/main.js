import { Schema } from 'prosemirror-model'
import { EditorState, Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    code_block: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      toDOM: () => ['pre', ['code', 0]],
      parseDOM: [{ tag: 'pre' }],
    },
    text: { group: 'inline' },
  },
})

const code = '{\n  x\n  y\n\n}'
const doc = schema.node('doc', null, [
  schema.node('paragraph', null, [schema.text('Code')]),
  schema.node('code_block', null, [schema.text(code)]),
])

// A minimal virtual caret positioned with coordsAtPos(head, 1), the way
// editor UIs place custom carets, tooltips, and drop indicators. On affected
// WebKit builds it visibly sits at the end of the previous line whenever the
// native caret is at a soft line start.
const caretBar = document.body.appendChild(document.createElement('div'))
Object.assign(caretBar.style, {
  position: 'fixed',
  width: '2px',
  background: '#f50',
  pointerEvents: 'none',
  display: 'none',
})

function repositionCaretBar(view) {
  const selection = view.state.selection
  if (!selection.empty || !view.hasFocus()) {
    caretBar.style.display = 'none'
    return
  }
  let coords
  try {
    coords = view.coordsAtPos(selection.head)
  } catch {
    caretBar.style.display = 'none'
    return
  }
  caretBar.style.display = 'block'
  caretBar.style.left = `${coords.left}px`
  caretBar.style.top = `${coords.top}px`
  caretBar.style.height = `${coords.bottom - coords.top}px`
}

const virtualCaret = new Plugin({
  view(editorView) {
    const reposition = () => repositionCaretBar(editorView)
    document.addEventListener('selectionchange', reposition)
    editorView.dom.addEventListener('focus', reposition)
    editorView.dom.addEventListener('blur', reposition)
    reposition()
    return {
      update: reposition,
      destroy() {
        document.removeEventListener('selectionchange', reposition)
      },
    }
  },
})

window.view = new EditorView(document.querySelector('#editor'), {
  state: EditorState.create({ doc, plugins: [virtualCaret] }),
})
