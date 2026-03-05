# encrypted-notes 开发计划（v1）

## 1. 需求分析结论

基于 `.draft/demand.md`，本次插件是一个“可编辑明文、落盘密文”的 VS Code 文本文件加密扩展，核心目标如下：

1. 提供可配置的“目标文件后缀列表”（默认覆盖常见文本类型）。
2. 在编辑器右上角（`editor/title`）提供 `加密/解密` 按钮。
3. 点击按钮输入密码后，对当前文件执行加密或解密。
4. 已解密会话中，密码需保存在内存变量中；后续保存时自动按该密码重新加密。
5. 为加密文件定义稳定的文件头标识和元数据格式，便于识别与演进。
6. 打开加密文件时自动要求输入密码；正确则展示明文，错误则保留密文并提示。

---

## 2. 方案细化（默认技术决策）

### 2.1 加密算法与参数

- 算法：`AES-256-GCM`（认证加密，优先于 CBC）。
- KDF：`PBKDF2-HMAC-SHA256`。
- 随机参数：
  - `salt`：16 bytes
  - `iv`：12 bytes（GCM 推荐）
- 迭代次数：`210000`（可在后续升级为配置项）。
- 密钥长度：32 bytes。

> 注：这里将“最新 AES 加密算法”落地为当前工程里最稳妥、可审计、内置可用的 AES-GCM 方案。

### 2.2 加密文件格式（v1）

```text
#__ENCRYPTED_FILE__#
{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":210000,"salt":"<base64>","iv":"<base64>","tag":"<base64>"}
<base64-ciphertext>
```

- 第 1 行：固定魔数（识别是否加密文件）。
- 第 2 行：JSON 元数据（版本、算法、参数）。
- 第 3 行：密文（Base64）。
- 判断规则：文件首行命中魔数即视为加密文件。

### 2.3 插件配置项

- `encrypted-notes.enabled`：是否启用（默认 `true`）。
- `encrypted-notes.fileExtensions`：处理的后缀名数组（默认示例：`["txt","md","markdown","json","yaml","yml","ini","log","csv"]`）。

### 2.4 运行时状态管理

- `passwordCache: Map<string, string>`：`uri -> password`（仅内存，不落盘）。
- `decryptedSession: Set<string>`：当前文档是否处于“已解密编辑态”。
- `internalEditGuard: Set<string>`：防止自动编辑触发递归事件。

### 2.5 关键交互流程

1. **点击按钮（加密/解密）**
   - 非加密文件：输入密码 -> 加密整篇 -> 写回文档。
   - 已加密文件：输入密码 -> 解密成功后写回明文并缓存密码。
2. **打开文档**
   - 命中加密魔数 -> 弹密码框。
   - 正确：解密并展示明文，缓存密码。
   - 错误：提示“密码错误”，保持密文不变。
3. **保存文档**
   - 如果文档属于 `decryptedSession` 且有缓存密码：在 `onWillSaveTextDocument` 中重新加密后保存。

---

## 3. 实施任务拆解

### 阶段 A：模板清理与基础重命名

1. 将旧模板元信息（`colorful-markdown`）替换为 `encrypted-notes`。
2. 更新 `package.json`：`name/displayName/description/commands/configuration/activationEvents`。
3. 更新 README（中英文）为加密插件文档。

### 阶段 B：核心加密模块

1. 新建 `src/lib/crypto.ts`：
   - `encryptText(plain, password)`
   - `decryptText(payload, password)`
   - `isEncryptedContent(text)`
2. 新建 `src/lib/encrypted-file.ts`：
   - 文件格式编解码（魔数 + 元数据 + 密文）。

### 阶段 C：命令与 UI 按钮

1. 新建命令 `encrypted-notes.toggleEncrypt`。
2. `contributes.menus.editor/title` 挂载按钮，标题先用 `加密/解密`（无 svg 前提下）。
3. 增加密码输入封装（统一 `showInputBox` 行为、空密码校验、取消处理）。

### 阶段 D：自动解密/自动加密生命周期

1. `onDidOpenTextDocument`：检测并触发解密流程。
2. `onWillSaveTextDocument`：会话内自动加密。
3. 增加循环保护和异常提示（防止重复触发、格式损坏、密码错误）。

### 阶段 E：质量与发布

1. 执行 `pnpm check`、`pnpm build`。
2. 手工回归：新建文件加密、重开解密、错误密码、保存再加密。
3. 产出可安装包（`vsce package`）。

---

## 4. 验收清单（MVP）

- [ ] 设置中可见并可编辑 `fileExtensions` 列表。
- [ ] 编辑器右上角出现 `加密/解密` 按钮。
- [ ] 普通文本文件可加密并写入带魔数格式。
- [ ] 已加密文件打开时自动要求密码。
- [ ] 正确密码可解密展示；错误密码有提示且不破坏文件。
- [ ] 已解密会话保存时会重新加密落盘。
- [ ] 重启 VS Code 后不保留密码（仅内存）。

---

## 5. 风险与约束

1. `onWillSave` 实现需谨慎，避免触发保存递归或文档状态异常。
2. 密码只存内存，VS Code 重启后需重新输入（安全优先）。
3. 仅处理文本文件，不覆盖二进制内容。
4. 若文件头被手工篡改，需给出“格式损坏”提示并中止解密。

---

## 6. 默认边界（本计划先按此执行）

1. 先实现单密码单文件会话，不做系统钥匙串持久化。
2. 先支持 UTF-8 文本内容。
3. 先聚焦本地 `file` scheme 文档，不处理远程虚拟文档。
4. 按 v1 文件协议实现，后续通过 `v` 字段做向后兼容扩展。
