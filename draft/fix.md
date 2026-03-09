### 优先修的

1. 配置改了不会立即生效
   - 位置：src/extension.ts / onDidChangeConfiguration
   - 问题：事件里没有调用 configs.update()
   - 影响：
     - fileExtensions
     - actionButtonLocation
     - passwordKeepMinute
       都不会真正更新，通常要重载窗口才像是“生效了”。
2. 虚拟文档如果在“没有 state 的情况下”被打开，会造出错误 state
   - 位置：src/virtual-edit/state.ts / refresh, getOrAdd, add
   - 问题：add(uri) 默认把传入的 URI 当作 sourceUri，但如果传入的是虚拟 URI，就会生成一个“source 也是虚拟 URI”的错误
     状态。
   - 影响：
     - 窗口恢复
     - 某些异常时序
     - 未来重构后遗漏初始化
       都可能触发。
   - 这是我觉得现在最危险的逻辑坑之一。
3. 最后一个明文 tab 关闭时，密码不一定被立即清掉
   - 位置：src/extension.ts / onDidChangeTabs
   - 现在逻辑是：
     - 先 Note.remove(uri)
     - remove 失败才 clear()
   - 如果 remove 成功，state 会直接从 map 删除，但 password/timer 未必先被清掉。
   - 影响：更偏内存残留问题，不一定立刻出错，但和“关闭最后一个明文 tab 就清空密码”的目标不完全一致。

### 中等问题

4. 首行 CodeLens 模式下，虚拟明文页拿不到按钮
   - 位置：src/core/code-lens.provider.ts
   - 问题：configs.supports(document.uri) 对虚拟 URI 会返回 false
   - 影响：
     - actionButtonLocation = FirstLine 时
     - 明文虚拟编辑器里可能没有你想要的操作入口
   - 和 editor/title 的行为不一致。
5. encrypt() 会直接 Note.add(document.uri)，覆盖已有 state
   - 位置：src/extension.ts / encrypt
   - 影响：
     - 可能丢掉已有缓存密码/计时器/会话状态
     - 也可能制造旧 timer 残留
   - 更稳妥的思路一般是“已有就复用，没有再建”。

### 低优先级

6. 密码缓存时间的单位换算有两个小坑
   - 位置：src/core/config.ts
   - 问题：
     - 初始值写成了 _ 60 _ 100，不是 \* 1000
     - 非法值 fallback 回的是分钟数本身，不是毫秒值
   - 虽然激活时大多会被 update() 覆盖，但实现上还是不干净。
7. README / package.nls / 实际代码有几处不一致
   - 例子：
     - README 里还有 secret-notes.enabled
     - README 里的命令列表和实际贡献命令不一致
     - README 写的加密头格式是 #**ENCRYPTED_FILE**#，代码实际是 ENCRYPTED_FILE
   - 影响：主要是误导用户，不是运行时 bug。
