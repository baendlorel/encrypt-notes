# Colorful Markdown

一个用于 VS Code 的 Markdown 元素上色插件。

## 功能

- 在 Markdown 编辑器中实时上色
- 配置页面内置亮/暗预设：`One Dark/Light Colorful`、`GitHub Dark/Light Cool`、`Ayu Dark/Light Pastel`
- 默认样式映射为空，需应用预设或手动设置后生效
- 支持元素：
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
- 每个元素可配置：
  - `background`
  - `color`
  - `decoration`
  - `fontweight`
  - `fontstyle`
  - `border`、`borderColor`、`borderRadius`、`borderStyle`、`borderWidth`
  - `outline`、`outlineColor`、`outlineStyle`、`outlineWidth`
  - `opacity`、`letterSpacing`
  - `gutterIconPath`、`gutterIconSize`
  - 嵌套 `before` / `after`（附加文本/图标与样式）

## 命令

- `Colorful Markdown: Refresh Markdown Colors`

## 设置示例

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

`gutterIconPath` 需要是绝对路径（或 URI），用于在编辑器左侧 gutter 显示图标。
`before` / `after` 支持：`contentText`、`contentIconPath`、`color`、`background`、`fontweight`、`fontstyle`、`decoration`、`border`、`borderColor`、`margin`、`width`、`height`。

## 开发

```bash
pnpm install
pnpm check
pnpm build
```

在 VS Code 中按 `F5` 启动 Extension Development Host 调试。
