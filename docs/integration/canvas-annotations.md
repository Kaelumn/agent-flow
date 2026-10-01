# 画布标注：嵌入 MSPbots 与消息协议

画布嵌入在 MSPbots 的对话旁边（iframe）。审阅人在流程图上画框、写说明，点击发送后，标注以系统通知的形式进入当前对话，由 agent 当场修改流程。

## 设计要点

- **只有一个对话**：对话在 MSPbots 里，画布只负责查看、编辑和标注，不另开聊天窗口。
- **无状态**：agent-flow 不保存标注。发送后画布清空标注；标注内容只存在于 MSPbots 的那条通知里。
- **消息自带上下文**：标注记录的是框住的节点和连线（id + 标题 + 条件），不是像素坐标。agent 拿到 id 后用 `flow_get` 读取完整定义，不需要额外工具。
- **带修订号**：消息里带上标注时草稿的 `revision`。agent 读到的修订号更新时，说明流程在此期间被改过，要先核对标注的目标是否还在。

## 画布交互

1. 底部工具栏点 **Annotate**（快捷键 `A`）进入标注模式：节点不可拖动、不可选中，滚轮缩放仍可用。
2. 拖出一个矩形，松开后在框旁输入说明，回车确认；可以画多个框，自动编号 ①②③。点击已有的框可修改说明或删除。
3. 点 **Send N**：把标注组装成消息发给外层页面，然后清空并退出标注模式。`Esc` 放弃全部标注并退出。

### 框住了什么

松开鼠标时按以下规则计算目标：

| 情况 | 目标 |
|---|---|
| 框与节点重叠超过节点面积的 30%，或框完全在某个节点内 | 这些节点 |
| 连线从框内穿过（框外节点之间的部分） | 这些连线 |
| 框内既没有节点也没有连线 | 离框中心最近的连线，记为“附近”；没有连线时取最近的节点 |
| 框住了全部节点的 60% 以上，且多于 4 个 | 整个流程 |

## 消息协议

通过 `window.parent.postMessage` 发送，`targetOrigin` 为外层页面的来源；只有来源在 `EMBED_ORIGINS` 白名单里才发送。

### 画布 → MSPbots

```jsonc
{
  "type": "agent-flow.annotations",
  "version": 1,
  "id": "a8f3…",                 // 本次发送的唯一 id，用于回执
  "text": "…",                   // 已排好版的通知全文，直接作为系统通知插入对话
  "flow": { "id": "g_…", "title": "New-employee onboarding", "revision": 17 },
  "annotations": [
    {
      "index": 1,
      "note": "这里少了经理审批",
      "scope": "elements",       // elements | near | flow
      "nodes": [{ "id": "assign_manager", "title": "Assign the hiring manager" }],
      "edges": [{ "id": "e_pc79gv", "source": "assign_manager", "target": "assign_groups", "condition": null }]
    }
  ]
}
```

`text` 示例：

```
[Agent Flow] 2 annotations on "New-employee onboarding" (flow g_…, draft revision 17)
1. 这里少了经理审批
   On: connection "Assign the hiring manager" → "Add groups" (edge e_pc79gv)
2. 条件写反了
   On: step "Check stock" (check_sku)
Read the flow with flow_get, apply the changes to the draft, then summarise what you changed.
If the flow's revision is now above 17, check that each target still exists before editing.
```

### MSPbots → 画布（回执）

```json
{ "type": "agent-flow.annotations.ack", "id": "a8f3…" }
```

MSPbots 收到消息后要做三件事：

1. 校验 `event.origin` 是 agent-flow 的地址。
2. 把 `text` 作为系统通知插入当前对话，并触发 agent 回复。
3. 向 `event.source` 回发回执。

画布 3 秒内没收到回执，就把 `text` 复制到剪贴板，并提示用户手动粘贴。

### 不在 MSPbots 中打开时

画布没有被嵌入，或外层来源不在白名单里时，发送按钮显示为 **Copy N**，直接把 `text` 复制到剪贴板。

## 嵌入方式

```html
<iframe src="https://flows.example.com/#/flows/g_…" allow="clipboard-write"></iframe>
```

`allow="clipboard-write"` 让收不到回执时的复制兜底能在 iframe 里工作。

## 本地试用

`apps/mock-msp` 自带一个模拟的 MSPbots 对话页，按上面的协议接收标注并回执：

1. `.env` 里设置 `EMBED_ORIGINS=http://localhost:4100`，然后重启后端。
2. 打开 `http://localhost:4100/host?flow=<流程 id>`，在右侧画布里标注并发送，左侧会出现系统通知。

## 配置

| 变量 | 说明 |
|---|---|
| `EMBED_ORIGINS` | 允许嵌入画布并接收标注的外层页面来源，逗号分隔，例如 `https://app.mspbots.ai`。同时用于响应头 `Content-Security-Policy: frame-ancestors`。为空时不限制嵌入，也不发送消息（只能复制）。 |
