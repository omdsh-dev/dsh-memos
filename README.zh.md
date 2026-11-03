# dsh-memos

> **中文** | [English](README.md)

让 DeepSeek Harness 的会话能**读取**你的 [memos](https://usememos.com)（usememos 自托管笔记）。配置一次服务器地址 + 访问令牌（PAT）后，agent 就能通过 `memos_search` / `memos_list` / `memos_get` 检索你的笔记。

## 功能

- **设置面板** — 在 Web 设置页（设置 → Memos）里配置服务器地址 / 访问令牌：保存、测试连接、清除，还有最近 5 条笔记预览。
- **memos_search** — 按关键词（匹配正文）和/或标签搜索笔记，返回摘要列表（id、摘要、标签、时间），支持分页与排序。
- **memos_list** — 按时间倒序浏览最近笔记，支持分页（`pageToken`）。
- **memos_get** — 按 id 读取单条笔记的完整内容（含标签、附件清单、创建/更新时间）。
- **memos_config** — 配置 `serverUrl`（实例地址）和 `accessToken`（PAT）；`reset: true` 清除凭据。
- **memos_status** — 查看是否已配置、服务器地址与令牌掩码、配置文件路径，不回显完整令牌。
- 凭据持久化到 `~/.dsh/dsh-memos.json`（权限 0600）。
- 系统提示公告：agent 知道何时该用这个插件。
- **只读设计**：插件不提供任何写入/修改/删除能力，PAT 泄露的风险面最小。

## 适配版本

针对 memos **v0.x API**（`/api/v1/...`，已在 v0.30.0 上核实）：
`GET /api/v1/memos`（列表 + CEL 过滤）、`GET /api/v1/memos/{id}`（单条）。

## 安装

```sh
# 本地安装（link）
dsh plugin --profile web add link:/path/to/dsh-memos
```

重启 `dsh web` 生效。插件无需构建——`lib/index.js` 是纯 ESM、零运行时依赖。

## 配置

1. 在 memos 网页端打开「设置 → Access Tokens / 访问令牌」，创建一个访问令牌（PAT）。
2. 在 DSH Web 设置页「Memos」面板填入服务器地址（如 `https://memos.example.com`）和令牌，点「测试连接」验证；或直接让 agent 配置：

```text
帮我配置 memos，服务器是 https://memos.example.com，令牌是 xxxx
```

3. 之后直接说：

```text
搜一下我 memos 里关于「路由协议」的笔记
把我最近 10 条 memos 列出来
把 memos 里 #ideas 标签下的笔记汇总一下
```

> PAT 等同于读取凭据：拿到它的人能读你的全部笔记。请保密；泄露后立刻在 memos 里删除该令牌，并用 `memos_config(reset: true)` 或设置面板清除本地配置。

## 说明

- 请求使用 Node 内置 `fetch`（Node 22+），零第三方依赖。
- 设置面板通过仅限本机的 `/api/dsh-memos` 路由族与宿主通信（loopback + 同源校验）。
- 搜索基于 memos 服务端的 CEL 过滤（`content.contains(...)`、`"tag" in tags`），在服务器侧完成，不会把整库拉取到本地。

## License

MIT
