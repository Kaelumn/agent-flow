# Agent Flow — 设计文档

## 1. 产品定位

给 MSP 的 SOP agent 用的**流程图服务**。

- **建图**：用户和 agent 聊天，agent 通过 MCP 增删改流程图；人在画布上查看、修改，或画框标注问题发回对话。
- **运行**：agent 按已发布的图执行。服务端只告诉它当前节点和可走的边，并拒绝不合法的流转。
- **流转决策和参数提取由 agent 负责**，本服务不调用业务工具，只负责约束和记录。

它要解决的问题是：SOP 写成 prompt 里的 Mermaid 时，agent 会漏步、乱序、编造工具名。

## 2. 核心概念

| 概念 | 说明 |
|---|---|
| Graph | 一个 SOP 流程，有一份可编辑的**草稿**（draft）和多个不可变的**版本**（version） |
| Node | `start` / `tool` / `end`。`tool` 节点即“步骤”，三种执行方式选一：调用工具目录中的一个工具、按 MSPbots 的某个 skill 执行，或都不选、由 agent 按指引自己完成（分类、提取、起草）。附带指引、参数来源、输出键名、期望输出字段（只作提示，不强制）和失败策略 |
| Edge | `source → target`，带自然语言 `condition`，由 agent 判断；多条出边时最多一条 `default` |
| Op | 对草稿的原子修改。REST 和 MCP 的所有写操作都转成 Op，走同一条写入路径（校验、乐观锁、历史、推送） |
| Revision | 草稿的修订号，用于乐观锁，每次写入加 1；没有实际变化的写入不产生新修订，只改节点位置的写入不记入修改历史 |
| Version | 发布时生成的快照。发布前必须通过校验，运行只针对版本 |
| Run | 基于某个版本的一次执行，记录当前节点、上下文（各节点输出）和每一步 |
| Annotation | 审阅人在画布上画框圈出的问题和说明。无状态：不入库，发送后作为系统通知进入 MSPbots 对话，见[画布标注](integration/canvas-annotations.md) |
| Tool Catalog | 可用工具及其参数 schema。从配置的 MCP 服务实时读取（服务名即系统名，`readOnlyHint` 决定是否写入），或从静态 JSON 读取（测试和离线开发用） |
| Skill Catalog | 步骤可选用的 skill（名称和说明），从 `SKILLS_URL` 定时读取。MSPbots 平台接口接入前由 mock-msp 的 `/skills` 提供 |

## 3. 校验规则

错误（error）会阻止发布，警告（warning）只做提示。

1. 恰好一个 `start`，至少一个 `end`。
2. 所有节点都能从 `start` 到达，也都能到达某个 `end`。
3. 没有指向 `start` 的边，`end` 没有出边，没有自环，没有重复边。
4. 有多条出边的节点，每条边都要有 `condition`，`default` 最多一条。
5. `tool` 节点必须绑定工具，工具必须在目录中存在；`args_hint` 的键必须是该工具的参数；必填参数缺少说明时给出警告。
6. `on_error: goto` 的目标节点必须存在。
7. `output_key` 在同一张图内不能重复。

## 4. 运行协议（MCP）

```
run_start(graph_id, inputs)            → 当前步骤
loop:
  run_current(run_id)                  → 当前节点、工具、参数说明、出边、上下文
  agent 调用业务工具
  run_submit(run_id, node_id, outcome, edge_id?)
     · node_id 必须是当前节点（防止乱序、跳步）
     · tool 节点必须提交 outcome（成功时带结果，失败时带错误）
     · edge_id 必须是当前节点的出边；只有一条出边时可以省略
     · 失败时按 on_error 处理：stop 终止运行，continue 按所选边继续，goto 跳到指定节点
  到达 end 节点时运行结束
```

## 5. 架构

```
apps/web      React + @xyflow/react   画布、节点和边的编辑、标注、版本、运行轨迹
apps/server   Fastify + MCP SDK       REST /api、MCP /mcp、SSE /api/events
packages/core 共享的领域模型、Op、校验器，前后端共用同一份
```

服务端分层：`http`（REST、MCP、SSE 路由）→ `services`（业务规则）→ `repositories`（SQL）→ `db`（Kysely 和方言）。

- **数据库抽象**：用 Kysely 做查询构建。方言由 `DB_DIALECT` 决定，当前是 `mysql`，以后切到 `postgres` 只需换方言驱动，repository 和迁移脚本不用改。所有 SQL 只写在 repository 里。可移植性约定：ID 由应用生成，存为 `varchar`；时间存 `bigint` 毫秒；JSON 在 repository 边界统一编码和解码。
- **多租户预留**：`graphs` 和 `runs` 带 `workspace_id`，其余表通过所属的 graph 或 run 隔离，每个查询都先校验归属。请求通过 Bearer Token 解析出身份（workspace 和 actor）。目前 token 在配置里定义，以后替换为真正的认证系统。
- **实时推送**：进程内事件总线，通过 SSE 推给画布；以后多实例部署时替换为 Redis。

## 6. 数据表

| 表 | 用途 |
|---|---|
| `graphs` | 元数据、草稿（JSON）、修订号、最新版本号 |
| `graph_versions` | 发布快照（JSON）和发布说明 |
| `graph_events` | 草稿的修改历史：谁在哪个修订号执行了哪些 Op |
| `runs` | 运行状态、当前节点、输入、上下文 |
| `run_steps` | 每一步的节点、选择的边、工具参数、结果或错误 |

## 7. 范围

- **本期**：建图（MCP 和画布）、校验、发布和版本、画布标注（嵌入 MSPbots）、修改历史、运行协议和轨迹高亮、静态工具目录、MySQL。
- **后续**：真实认证和 RBAC、PostgreSQL 实测、多实例部署（Redis）、工具声明返回结构（MCP outputSchema，让校验器在建图时检查引用的字段名）。
- **下期规划**：[运行生命周期](roadmap/run-lifecycle.md)（租约与接管、两阶段步骤与幂等、重试、人工审批与任务节点）。
