# Radio Archive

OpenWebRX+ 录音文件的时间轴播放器插件。将 AudioRecorder 录制的音频文件以可视化时间轴形式展示，方便按频率和日期浏览、回放历史录音。

## 项目架构

本项目使用 **Vite** 构建框架，采用 **Vue 3 Composition API** 开发，代码结构模块化设计。

### 技术栈

- **构建工具**: Vite 5
- **前端框架**: Vue 3 (通过 CDN 外部加载，减小打包体积)
- **语言**: JavaScript (ES6+)
- **样式**: 原生 CSS

### 目录结构

```
radio-archive/
├── package.json          # 项目配置
├── vite.config.js        # Vite 构建配置
├── index.html            # 开发环境入口
├── src/
│   ├── main.js           # 应用入口
│   ├── App.vue           # 主组件
│   ├── modules/          # 功能模块
│   │   ├── silenceAnalyzer.js   # 静噪分析 (Web Audio API + IndexedDB 缓存)
│   │   ├── i18n.js              # 国际化 (en/zh/ja)
│   │   └── fileParser.js        # 文件名解析
│   ├── composables/      # Vue Composables
│   │   ├── usePlayer.js         # 播放器状态和逻辑
│   │   ├── useTimeline.js       # 时间轴缩放/拖拽逻辑
│   │   └── useRecordings.js     # 录音数据管理
│   ├── components/       # Vue 组件
│   │   ├── FrequencySelector.vue
│   │   ├── DateSelector.vue
│   │   ├── Timeline.vue
│   │   ├── PlayerControls.vue
│   │   └── RecordingList.vue
│   └── styles/           # 样式文件
│       ├── main.css
│       ├── timeline.css
│       └── player.css
└── dist/                 # 构建输出
    ├── radio-archive.js
    └── radio-archive.css
```

### 设计说明

- **模块化**: 将原 2000 行单文件拆分为独立模块，便于维护和测试
- **Composables**: 使用 Vue 3 Composition API 的 composable 模式，逻辑复用清晰
- **外部 Vue**: Vue 3 通过 CDN 加载，打包文件仅 ~40KB (gzip ~12KB)
- **IIFE 输出**: 构建为自执行函数格式，兼容原有的脚本注入方式

## 开发

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
npm install
```

### 开发模式

启动开发服务器，支持热更新：

```bash
npm run dev
```

访问 http://localhost:5173 查看开发页面（包含模拟数据）。

### 监视模式

自动监视文件变化并重新构建：

```bash
npm run watch
```

构建输出到 `dist/` 目录，配合软链接可实现实时更新。

### 构建

生产环境构建：

```bash
npm run build
```

输出文件：
- `dist/radio-archive.js` (~40KB)
- `dist/radio-archive.css` (~9KB)

## 部署

### 方式一：直接复制（推荐）

将 `dist/` 目录下的文件复制到 OpenWebRX+ 插件目录：

```bash
cp dist/radio-archive.js dist/radio-archive.css \
   /path/to/openwebrx/plugins/receiver/radio-archive/
```

Docker 环境示例：

```bash
cp dist/radio-archive.js dist/radio-archive.css \
   ~/openwebrxplus/volumes/plugins/receiver/radio-archive/
```

### 方式二：软链接（开发环境）

创建软链接，方便开发时实时更新：

```bash
# 备份原文件
cd /path/to/openwebrx/plugins/receiver/radio-archive/
mv radio-archive.js radio-archive.js.bak
mv radio-archive.css radio-archive.css.bak

# 创建软链接
ln -s /path/to/radio-archive/dist/radio-archive.js radio-archive.js
ln -s /path/to/radio-archive/dist/radio-archive.css radio-archive.css
```

然后使用 `npm run watch` 开发，修改代码后自动重新构建。

## OpenWebRX+ 配置

### 0. 配置 Background Decoding 和 AudioRecorder

参考官方文档：https://fms.komkon.org/OWRX/

1. 进入 **Settings → Background Decoding**，勾选 **Enable background decoding services**，并启用 **Audio Recorder**

2. 进入 **Settings → SDR Devices and Profiles → \<Device\>**，添加 **Run background services on this device** 选项并启用

3. 编辑 bands.json 添加需要录制的频率：

```bash
sudo nano /etc/openwebrx/bands.json
```

添加 `audio` 模式的频率条目，例如：

```json
"frequencies": {
    "audio": { "frequency": 145700000, "underlying": "nfm" }
}
```

或多个频率：

```json
"frequencies": {
    "audio": [
        { "frequency": 97500000, "underlying": "wfm" },
        { "frequency": 145700000, "underlying": "nfm" }
    ]
}
```

4. 重启 OpenWebRX：

```bash
sudo systemctl restart openwebrx
```

5. 验证配置：进入 **Settings** 主界面，在 **Services** 列表中确认出现类型为 **AUDIO** 的服务

### 1. 安装插件文件

将构建输出文件放入 plugins 目录：

```
plugins/receiver/radio-archive/
├── radio-archive.js
├── radio-archive.css
└── README.md
```

### 2. 注入脚本

由于 OpenWebRX+ 标准插件仅在 receiver 页面加载，而本插件需要在 `/files` 页面运行，因此需要通过 Photo description 注入脚本。

在 **Settings → General Settings → Photo description** 中添加：

```html
<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
<script src="static/plugins/receiver/radio-archive/radio-archive.js"></script>
```

### 3. 配置录音保留数量（可选）

在 **Settings → General Settings → Receiver limits → Maximum number of files** 中调整保留的文件数量（默认 20 个）。

## 使用

访问 `/files` 页面，选择频率和日期即可浏览录音。

### 功能特性

- **时间轴视图**: 24 小时时间轴展示录音分布
- **静噪检测**: 自动分析并高亮显示有效音频段
- **跳过静噪**: 播放时自动跳过静音部分
- **缩放平移**: 支持鼠标滚轮/触摸板手势缩放和拖拽
- **连续播放**: 自动播放下一个录音
- **多语言**: 支持中文、英文、日文
- **缓存**: IndexedDB 缓存分析结果，避免重复处理

### 快捷键

- `Space`: 播放/暂停
- `←`: 后退 5 秒
- `→`: 前进 5 秒

## License

MIT
