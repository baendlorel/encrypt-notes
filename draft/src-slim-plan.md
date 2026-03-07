# src 扫描后的精简方案

## 1. 当前实现概况

`src` 目前已经具备完整可用链路，核心分为四层：

1. `extension.ts`
   - 负责命令注册、CodeLens、上下文状态、自动解密、自动保存后的状态同步。
   - 当前同时承担了状态中心、流程编排、UI 判定、事件订阅四类职责，是主要复杂度来源。
2. `virtual-edit/`
   - 通过自定义 `FileSystemProvider` 提供“明文编辑、落盘密文”的虚拟文件视图。
   - 这是当前方案里最关键、也最值得保留的部分。
3. `lib/crypto.ts`
   - 封装 AES-256-GCM + PBKDF2-SHA256 的加解密协议。
   - 结构清楚，边界稳定，暂时不建议大改。
4. `core/config.ts`、`core/consts.ts`
   - 提供配置与常量，但仍有少量命名和配置映射细节可收口。

## 2. 目前最明显的冗余点

1. `extension.ts` 顶层散落多个会话状态：
   - `passwordCache`
   - `decryptedSession`
   - `skippedAutoDecrypt`
   - `decryptPromptInProgress`
   - `encryptedOnDiskState`
   - 这些状态经常被一起读写、一起清理，但现在分散在多个函数里重复处理。
2. 加密状态判定有重复：
   - `isSupportedDocument`
   - `getEncryptedOnDiskState`
   - `updateEditorContext`
   - `tryAutoDecrypt`
   - 几处都在做“是否支持 / 是否已加密 / 是否可解密”的近似判断。
3. 生命周期回调偏多，且缺少统一入口：
   - `onDidOpenTextDocument`
   - `onDidChangeActiveTextEditor`
   - `onDidSaveTextDocument`
   - `onDidCloseTextDocument`
   - `onDidChangeTextDocument`
   - `onDidChangeConfiguration`
   - 这些回调内部都在交叉调用 `refreshEncryptedOnDiskState`、`tryAutoDecrypt`、`updateEditorContext`。
4. “永久解密”和“打开虚拟明文编辑”两条路径部分逻辑重复：
   - 都涉及密码确认、解密校验、会话状态切换、编辑器切换。

## 3. 精简目标

不改协议、不改交互、不推翻虚拟编辑方案，只做结构收敛。

目标是把当前实现收敛成：

1. 一个会话状态对象
2. 一组统一的文档判定函数
3. 一个事件协调入口

## 4. 建议的精简方案

### A. 先抽一个 `session-store`

建议新建一个内部模块，统一管理当前这些运行时状态：

- `getPassword/setPassword/clearPassword`
- `markDecrypted/isDecrypted`
- `markSkipAutoDecrypt/shouldSkipAutoDecrypt`
- `markPrompting/isPrompting`
- `setEncryptedOnDisk/isEncryptedOnDisk`
- `clearSession(sourceKey)`

这样可以直接消掉 `extension.ts` 里大量重复的 `delete/set/has` 组合。

### B. 再抽一个 `document-state`

把以下判断集中到一个地方：

- 是否支持当前文档
- 是否原文件已加密
- 是否编辑器内是密文
- 是否可以加密
- 是否可以解密
- 是否可以永久解密

输出一个统一对象，例如：

```ts
{
  supported: boolean,
  encryptedOnDisk: boolean,
  encryptedInEditor: boolean,
  canEncrypt: boolean,
  canDecrypt: boolean,
  canPermanentDecrypt: boolean,
}
```

然后 `CodeLensProvider` 和 `updateEditorContext` 都只消费这一个结果，避免重复分叉。

### C. 最后收口事件回调

把目前多个事件里的公共动作合并为少数几个协调函数：

- `syncDocumentState(document)`
- `handleDocumentOpened(document)`
- `handleDocumentSaved(document)`
- `handleDocumentClosed(document)`

这样 `activate()` 里只保留注册代码，不再堆业务细节。

## 5. 推荐执行顺序

1. 先抽 `session-store`
   - 风险最低，改动收益最大。
2. 再抽 `document-state`
   - 可以顺手消掉上下文刷新和 CodeLens 的重复判断。
3. 最后整理 `activate()` 内事件注册
   - 只做搬运，不改用户行为。

## 6. 不建议现在动的部分

1. `virtual-edit/virtual-edit.ts`
   - 当前职责单一，而且是整体方案成立的基础。
2. `lib/crypto.ts`
   - 协议已经稳定，除非要升级文件格式，否则不应混入本轮精简。
3. i18n 文案
   - 这轮先不要碰，避免结构改造和文案改造相互干扰。

## 7. 一句话结论

这份代码当前不是“功能缺失”，而是“入口文件承担过多职责”。最划算的精简方式不是重写，而是把 `extension.ts` 里的状态、判定、事件协调各拆一层，让现有虚拟明文编辑方案继续保留。
