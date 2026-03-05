# Colorful Markdown

Color markdown elements in VS Code with configurable styles.

## Features

- Works in the markdown editor (real-time)
- Built-in light/dark presets in config page: `One Dark/Light Colorful`, `GitHub Dark/Light Cool`, `Ayu Dark/Light Pastel`
- Default style map is empty until you apply a preset or custom styles
- Supports these elements:
  - `heading`
  - `heading1`
  - `heading2`
  - `heading3`
  - `heading4`
  - `heading5`
  - `heading6`
  - `blockquote`
  - `list`
  - `bold`
  - `italic`
  - `strikethrough`
  - `link`
  - `inlineCode`
  - `codeFence`
- Every element supports:
  - `background`
  - `color`
  - `decoration`
  - `fontweight`
  - `fontstyle`
  - `border`, `borderColor`, `borderRadius`, `borderStyle`, `borderWidth`
  - `outline`, `outlineColor`, `outlineStyle`, `outlineWidth`
  - `opacity`, `letterSpacing`
  - `gutterIconPath`, `gutterIconSize`
  - nested `before` / `after` (attachment text/icon and styles)

## Command

- `Colorful Markdown: Refresh Markdown Colors`

## Settings

```json
{
  "colorful-markdown.enabled": true,
  "colorful-markdown.styles": {
    "heading": {
      "color": "#ff7f50",
      "fontweight": "800",
      "outline": "1px solid #ff7f5033",
      "borderRadius": "3px",
      "before": {
        "contentText": "# ",
        "color": "#ff7f50aa"
      }
    },
    "blockquote": {
      "color": "#6aa6ff",
      "decoration": "underline wavy #6aa6ff66"
    },
    "italic": {
      "color": "#2ec4b6",
      "fontstyle": "italic"
    },
    "inlineCode": {
      "background": "#1f1f1f66",
      "color": "#9ef01a",
      "fontweight": "600",
      "border": "1px solid #9ef01a55",
      "borderRadius": "4px"
    },
    "link": {
      "color": "#4cc9f0",
      "decoration": "underline",
      "after": {
        "contentText": " ->",
        "color": "#4cc9f0aa",
        "fontstyle": "italic",
        "margin": "0 0 0 .2em"
      }
    }
  }
}
```

`gutterIconPath` must be an absolute file path (or URI) to an image shown in editor gutter.
`before` / `after` support: `contentText`, `contentIconPath`, `color`, `background`, `fontweight`, `fontstyle`, `decoration`, `border`, `borderColor`, `margin`, `width`, `height`.

## Development

```bash
pnpm install
pnpm check
pnpm build
```

Press `F5` in VS Code to launch an Extension Development Host.
