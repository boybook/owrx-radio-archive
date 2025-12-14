# Radio Archive

OpenWebRX+ 录音文件的时间轴播放器插件。将 AudioRecorder 录制的音频文件以可视化时间轴形式展示，方便按频率和日期浏览、回放历史录音。

## 安装步骤

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

将 `radio-archive` 文件夹放入 plugins 目录：

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
