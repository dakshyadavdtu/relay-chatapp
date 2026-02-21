# XSS and HTML Rendering Security

## No HTML Rendering; React Escaping Used

The frontend does **not** render user-generated content as HTML. All message content and other user-supplied text is rendered via React's JSX children (e.g. `{msg.content}`), which React escapes by default.

- **No `dangerouslySetInnerHTML`** — Not used in the codebase.
- **No markdown renderer** — No react-markdown, remark, or rehype.
- **No raw HTML injection** — User content is always passed as text children.

## Where User Content Is Rendered

- `ChatWindow.jsx`: `<p>{msg.content}</p>` — React escapes.
- `Sidebar.jsx`: Previews and snippets use `{msg.content}` — React escapes.

## XSS Protection

- React escapes all string children — `<script>`, `<img onerror=...>`, etc. are displayed as text, not executed.
- If you add HTML rendering (e.g. markdown, rich text), use DOMPurify to sanitize before `dangerouslySetInnerHTML`.
