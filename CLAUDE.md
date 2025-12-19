# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 OpenWebRX+ 的录音文件时间轴播放器插件，将 AudioRecorder 录制的音频以可视化时间轴形式展示。该插件设计为注入到 OpenWebRX+ 的 `/files` 页面中运行。

## 常用命令

```bash
# 安装依赖
npm install

# 开发模式 (启动 Vite 开发服务器，访问 http://localhost:5173/files)
npm run dev

# 监视模式 (自动重新构建到 dist/)
npm run watch

# 生产构建 (输出到 dist/radio-archive.js 和 dist/radio-archive.css)
npm run build
```

## 架构

### 构建配置

- **Vite + IIFE**: 构建为自执行函数格式，方便脚本注入
- **Vue 外部化**: 生产构建时 Vue 从 CDN 加载 (`window.Vue`)，开发时由 Vite 打包
- **输出文件**: `dist/radio-archive.js` (~40KB), `dist/radio-archive.css` (~9KB)

### 入口点流程 (src/main.js)

1. 检测运行环境 (开发/生产)
2. 仅在 `/files` 页面激活
3. 等待 Vue 加载 (生产模式)
4. 将 Vue 应用挂载到原始文件列表页面中

### 核心模块

**Composables (src/composables/)** - 使用 Vue 3 Composition API 的逻辑模块:
- `useRecordings.js`: 录音数据管理、DOM 解析、静噪分析触发、日期/频率筛选
- `usePlayer.js`: 音频播放控制、跳过静噪逻辑、连续播放
- `useTimeline.js`: 时间轴缩放/平移、手势处理、刻度计算

**Modules (src/modules/)** - 纯函数工具:
- `silenceAnalyzer.js`: Web Audio API 静噪检测 + IndexedDB 缓存
- `fileParser.js`: 从文件名解析频率、日期、时间 (格式: `REC-YYMMDD-HHMMSS-FREQ.mp3`)
- `i18n.js`: 多语言支持 (en/zh/ja)

### 组件层次 (src/components/)

```
App.vue
├── FrequencySelector.vue  # 频率选择按钮组
├── DateSelector.vue       # 日期导航
├── Timeline.vue           # 24小时时间轴视图
├── PlayerControls.vue     # 播放器控制栏
└── RecordingList.vue      # 录音列表
```

### 数据流

1. `useRecordings.parseFilesFromDOM()` 从页面 DOM 提取文件列表
2. 文件名通过 `fileParser` 解析为结构化数据
3. `silenceAnalyzer` 分析音频静噪段并缓存到 IndexedDB
4. 用户交互通过 composables 处理，状态通过 Vue reactive 系统更新

## 开发注意事项

- 开发时 Vite 在 `/files` 路径提供 index.html (通过自定义插件)
- index.html 包含模拟的 OpenWebRX+ 页面结构和测试文件
- 生产环境下依赖全局 `window.Vue`，需通过 CDN 脚本注入
