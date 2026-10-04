# @sophialin/dsh-context-continuity

This repository is the `@sophialin` fork of the context-continuity engine.

The engine was extracted from `packages/context-continuity` of
`wowyuarm/dsh-plugins` at tag `@wowyuarm/dsh-context-continuity@0.1.6`, renamed to
`@sophialin/dsh-context-continuity`, and repointed at this repository. `src/`,
`tests/` and the exports below are the upstream release; only the package name,
the repository metadata and the standalone build configuration differ.

The fork is published to the registry as `@sophialin/dsh-context-continuity`. The
release notes below 0.1.7 are upstream's own: they describe the upstream package
name and, where they mention npm, the upstream publication.

## 0.1.10

### Patch Changes

- **中文**：整包移到 `@sophialin` scope。npm 上没有 `@aembers` 组织，发布被 `Scope not found` 拒掉。改名同时修好了两个 README——它们在更早一次改名脚本里被一个失控的替换损坏（整篇的 `h` 变成了 `t`：`https://` 读作 `tttps://`、`dsh-` 读作 `dst-`、`shields` 读作 `stields`、`English` 读作 `Englist`）。现已从上游 `@wowyuarm/dsh-context-continuity@0.1.6` 的原文恢复，再按新 scope 重新改名。`src/` 只动了各文件头的 `@module` 注释。
- **English**: the package moves to the `@sophialin` scope. npm has no `@aembers` organization, so the publish was refused with `Scope not found`. The rename also repairs both READMEs, which an earlier rename script had corrupted with a runaway replacement — every `h` had become a `t`, so `https://` read `tttps://`, `dsh-` read `dst-`, `shields` read `stields` and `English` read `Englist`. They are restored from the upstream `@wowyuarm/dsh-context-continuity@0.1.6` text and renamed to the new scope. `src/` changed only in its file-header `@module` comments.

## 0.1.9

### Patch Changes

- **中文**：整条 DSH 线从 `0.2.0-rc.1/rc.2` 搬到 `0.2.1-alpha.1`：七个 `@deepseek-ai/dsh-*` peer 现在声明 `>=0.2.1-alpha.1 <0.2.2`，开发依赖钉在 `0.2.1-alpha.1` —— 声明的那条线就是测试实跑的那条线。`@deepseek-ai/cordis` 从 `^4.0.1` 改为 `~4.0.5-alpha.1`：候选线对 cordis 的声明是 `~4.0.5-alpha.1`，而按更早的 tuple 写的 caret 永远不会接受这个预发布版本，于是消费者的空目录安装会以 peer 冲突失败，而不是解析出宿主实际用的那份 cordis。`dsh-session-query` 仍是可选 peer。`src/` 与导出未动。
- **English**: the whole DSH line moves from `0.2.0-rc.1/rc.2` to `0.2.1-alpha.1`: the seven `@deepseek-ai/dsh-*` peers now declare `>=0.2.1-alpha.1 <0.2.2` and the development dependencies pin `0.2.1-alpha.1` — the declared line is the line the tests run on. `@deepseek-ai/cordis` moves from `^4.0.1` to `~4.0.5-alpha.1`: the candidate line declares cordis at `~4.0.5-alpha.1`, and a caret written on an older tuple never admits that prerelease, so a consumer's empty-directory install failed with a peer conflict instead of resolving the cordis the host actually uses. `dsh-session-query` stays an optional peer. `src/` and the exports are untouched.

## 0.1.8

### Patch Changes

- **中文**：0.1.7 的 `prepare` 路线走不通。pnpm 拒绝为 git 托管的包执行构建脚本，除非**每一个消费者**都在自己的 `pnpm-workspace.yaml` 里按「解析后的 tarball URL + commit sha」逐版本放行（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）——那等于让每台宿主维护一张随版本漂移的清单。改为把 `lib/` 提交进仓库、撤掉 `prepare`：消费方零配置，代价是构建产物进版本库，所以 CI 增加一道闸门 —— 重新构建后 `git diff --exit-code lib`，`lib/` 一旦过期就红。
- **English**: 0.1.7's `prepare` route does not work. pnpm refuses to execute a git-hosted package's build scripts unless *every consumer* allowlists it in its own `pnpm-workspace.yaml`, keyed by the resolved tarball URL and commit sha (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`) — one entry per version, per host. Instead `lib/` is committed and `prepare` is removed, so consumers need no configuration. The cost is built output in version control, so CI gains a gate: a fresh build followed by `git diff --exit-code lib`, which goes red the moment `lib/` is stale.

## 0.1.7

### Patch Changes

- **中文**：本 fork 自己的发布。`prepare` 在安装时生成 `lib/`，于是这个包可以被当作 git 依赖直接消费（`github:AEmbers/dsh-context-continuity#v0.1.7`），不再需要一个兄弟目录；`lib/` 依旧不进版本库。`src/`、导出与 peer 范围都没动。
- **English**: this fork's own release. `prepare` builds `lib/` on install, so the package can be consumed directly as a git dependency (`github:AEmbers/dsh-context-continuity#v0.1.7`) with no sibling checkout; `lib/` still stays out of version control. `src/`, the exports and the peer range are untouched.

## 0.1.6

### Patch Changes

- [中文](#cn-v0-1-6) | [English](#en-v0-1-6)
  
  <h3 id="cn-v0-1-6">中文</h3>
  
  适配 DeepSeek Harness `0.2.0-rc.1`。
  
  **改了什么**
  
  - **DSH 线整条搬到 `0.2.0-rc.1`**：七个 `@deepseek-ai/dsh-*` peer 现在声明 `>=0.2.0-rc.1 <0.2.1`，开发依赖钉在 `0.2.0-rc.1` —— 声明的那条线就是测试实跑的那条线。`@deepseek-ai/cordis` 仍是 `^4.0.1`，`dsh-session-query` 仍是可选 peer。
  - **不再跨世代解析**：引擎只声明这一条线，所以装在同一世代的宿主上时，会话包用宿主自己那一份，而不是把另一世代的 peer 拷贝嵌进安装树。
  - **npm 元数据指向 monorepo**：`repository` 现在指向 `wowyuarm/dsh-plugins` 的 `packages/context-continuity`。
  
  **兼容性**
  
  `src/` 与导出一个字节没动，宿主侧不用改代码。宿主仍停在 `0.1.7-rc.x` 时，npm 会报 peer 冲突告警，引擎作为依赖仍可安装。
  
  **验证**
  
  本地：`check:peers`、typecheck、boundaries、214/214 测试（7 个文件）、build 全绿，全部跑在钉住的 `0.2.0-rc.1` 上。
  
  ```
  npm i @wowyuarm/dsh-context-continuity@0.1.6
  ```
  
  <h3 id="en-v0-1-6">English</h3>
  
  Adapts to DeepSeek Harness `0.2.0-rc.1`.
  
  **What changed**
  
  - **The DSH line moved as a whole to `0.2.0-rc.1`**: the seven `@deepseek-ai/dsh-*` peers now declare `>=0.2.0-rc.1 <0.2.1`, pinned in devDependencies to `0.2.0-rc.1` — the line the tests actually run against. `@deepseek-ai/cordis` stays `^4.0.1` and `dsh-session-query` stays an optional peer.
  - **No more cross-generation resolution**: the engine declares this one line, so on a host of the same generation the session packages come from the host's own copy instead of another generation's peer copy nested inside the install tree.
  - **npm metadata points at the monorepo**: `repository` now points at `packages/context-continuity` of `wowyuarm/dsh-plugins`.
  
  **Compatibility**
  
  `src/` and the exports are untouched, so hosts need no code change. A host still on `0.1.7-rc.x` sees npm peer-conflict warnings; the engine still installs as a dependency.
  
  **Verification**
  
  Local: `check:peers`, typecheck, boundaries, 214/214 tests (7 files), and build all green, run against the pinned `0.2.0-rc.1`.
  
  ```
  npm i @wowyuarm/dsh-context-continuity@0.1.6
  ```
