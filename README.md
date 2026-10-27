# VoxBloom · 声线练习实验室

VoxBloom 是一款隐私优先、完全在浏览器本地运行的声线练习可视化工具。它实时显示音高、音分、频谱重心、练习区间命中率和音高波动，并支持同一次练习里的 A/B 录音对照。

> VoxBloom 只描述声音信号，不评价性别、passability、声音“好坏”或治疗效果，也不是语音治疗或医疗设备。

![VoxBloom 界面预览](assets/preview.png)

## 功能

- 实时基频检测、十二平均律音名与音分偏差
- 可调整的练习音高区间和实时音高轨迹
- 10 / 15 / 30 秒练习目标、完成进度与温和提示
- 频谱重心、输入电平与目标区间可视化
- 实时信号质量、静音输入和接近削波提示
- 持续元音、滑音与短句三种练习模式
- 有效发声时间、平均音高、区间命中率与音高波动
- A/B 本地录音、播放、下载、波形预览和离线音高分析
- A/B 平均值、稳定度、命中率和发声时长差值
- 练习摘要保存在 `localStorage`，可导出 CSV
- 麦克风音频不上传，无账号、分析埋点或远程数据库
- PWA 安装与离线界面，适配手机、平板和桌面
- GitHub Pages、Netlify、Vercel、Docker 和普通静态服务器部署配置

## 为什么用 Pitchy

项目使用 MIT 许可的 [Pitchy](https://github.com/ianprime0509/pitchy) 实现 McLeod Pitch Method。相比自行编写自相关算法，成熟的音高检测库更容易维持可解释性和测试稳定性。

为了保持静态站无需构建，浏览器版本以源码模块保存在：

```text
assets/pitchy.js
assets/fft.js
```

原始许可证与修改说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 音频链路

```mermaid
flowchart LR
  Mic[麦克风] --> GUM[getUserMedia]
  GUM --> Audio[Web Audio API]
  Audio --> Time[时域采样]
  Audio --> Freq[频域数据]
  Time --> Pitchy[Pitchy / MPM]
  Time --> RMS[RMS 输入电平]
  Freq --> Centroid[频谱重心]
  Pitchy --> Canvas[实时轨迹与指标]
  RMS --> Canvas
  Centroid --> Canvas
  GUM --> Recorder[MediaRecorder]
  Recorder --> Blob[本地内存 Blob]
  Blob --> Worker[Module Worker 离线分析]
  Worker --> AB[A/B 片段差值]
  Canvas --> LocalStore[本机练习摘要]
```

网络线不存在：麦克风、分析结果与录音均不发送到远程端点。

## 本地运行

需要 Node.js 18 或更高版本。运行应用本身不需要安装依赖。

```bash
node scripts/serve.mjs
```

打开 `http://127.0.0.1:4190`。

运行测试：

```bash
node --test
```

如果要从锁文件恢复开发依赖：

```bash
pnpm install
```

## 麦克风与浏览器支持

- 需要 `MediaDevices.getUserMedia`、Web Audio API 和 MediaRecorder。
- 首次启动麦克风时，浏览器会请求权限。
- 推荐使用最新版 Chrome、Edge、Safari 或 Firefox。
- GitHub Pages 和自定义部署必须使用 HTTPS，`localhost` 是允许的开发环境例外。
- 自托管时需要允许同源页面使用麦克风：

```text
Permissions-Policy: microphone=(self)
```

## 隐私

- 音频分析在当前浏览器的 Web Audio 图中完成。
- 录音片段只存在于当前标签页内存，刷新或关闭页面后消失。
- 练习摘要不包含音频，只保存时间、平均音高、命中率、波动和有效时长。
- 应用不发送音频、指标或导出内容到服务器。
- 浏览器与操作系统自身的音频处理策略仍可能适用。

## 部署

### GitHub Pages

1. 推送项目到 `main` 分支。
2. 打开 `Settings → Pages`。
3. 将 Source 设置为 `GitHub Actions`。
4. `.github/workflows/pages.yml` 会在测试通过后发布。

### Netlify

项目已包含 `netlify.toml`。导入仓库后不需要构建命令，发布目录使用项目根目录。

### Vercel

项目已包含 `vercel.json`。导入仓库后选择 `Other`，不设置 Build Command，输出目录保持项目根目录。

### Docker

```bash
docker build -t voxbloom-voice-lab .
docker run --rm -p 8080:80 voxbloom-voice-lab
```

打开 `http://127.0.0.1:8080`。

## 项目结构

```text
.
├── assets/
│   ├── app.js
│   ├── analysis-worker.js
│   ├── fft.js
│   ├── guide.js
│   ├── icon.svg
│   ├── lucide.min.js
│   ├── pitchy.js
│   └── styles.css
├── licenses/
├── scripts/
│   └── serve.mjs
├── src/
│   ├── audio-math.js
│   └── recording-analysis.js
├── tests/
│   ├── audio-math.test.js
│   └── recording-analysis.test.js
├── .github/workflows/pages.yml
├── index.html
├── guide.html
├── manifest.webmanifest
├── MODEL.md
├── netlify.toml
├── sw.js
└── vercel.json
```

## 边界

- 频谱重心不是“共鸣位置”，也不能直接判断头声、胸声或声道状态。
- 音高区间是用户自定义的练习参照，不是疗效标准。
- 一次读数会受设备、麦克风距离、房间反射、噪声门和浏览器音频处理影响。
- 如有疼痛、持续嘶哑、吞咽困难或呼吸不适，请停止练习并咨询合格医疗或语音治疗专业人员。

## 许可

源代码采用 MIT License。第三方组件许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
