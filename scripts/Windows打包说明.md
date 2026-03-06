# FluxVita Windows 客户端使用说明

> 面向 Windows 用户。请先查看「方式一」有无现成安装包，没有再走「方式二」自行打包。

---

## 方式一：下载现成安装包（推荐）

目前 Windows 安装包由有 Windows 电脑的同事手动打包后上传。如果已有版本，可在此处下载：

**GitLab Release 页面：**
```
https://gitlab.fluxvitae.com/Aiden/allinone/-/releases
```

找到最新版本，下载 `FluxVita_x.x.x_x64-setup.exe`，双击安装即可。

> 如果 Release 页面没有 Windows 安装包，说明暂时没有人打包，请走方式二。

---

## 方式二：自行打包（无现成安装包时）

> 需要 Windows 10/11（x64），约 10GB 磁盘空间，首次约 30-40 分钟。

### 第一步：获取源码

```
git clone https://gitlab.fluxvitae.com/Aiden/allinone.git
cd allinone
```

没有 Git 的话，在 GitLab 页面点 **Code → Download ZIP**，解压到任意目录。

---

### 第二步：双击运行打包脚本

进入源码目录，找到 `scripts` 文件夹，**双击 `build-windows.bat`**：

```
allinone/
└── scripts/
    └── build-windows.bat  ← 双击这个
```

弹出「你要允许此应用对你的设备进行更改吗？」点 **「是」**。

---

### 第三步：等待自动完成

脚本会自动检测并安装所有缺少的工具：

| 工具 | 用途 | 大小 |
|------|------|------|
| Node.js | 运行打包命令 | ~30 MB |
| Rust | 编译客户端核心 | ~500 MB |
| MSVC C++ Build Tools | Rust 编译依赖 | ~3-5 GB |
| NSIS | 生成 Windows 安装包 | ~5 MB |
| WebView2 | 应用运行环境（Win11 自带） | ~100 MB |

全程无需手动操作，窗口中可以看到实时进度。**首次运行**耗时约 30-40 分钟，**后续运行**约 5-10 分钟。

---

### 第四步：获取安装包

打包成功后，脚本会自动打开输出目录：

```
src-tauri\target\release\bundle\nsis\
└── FluxVita_x.x.x_x64-setup.exe  ← 这就是安装包
```

可以将此文件分发给其他 Windows 同事，或上传到 GitLab Release 供大家下载。

---

## 安装后使用

1. 双击安装包，一路点「下一步」完成安装
2. 桌面会出现 FluxVita 图标，双击启动
3. 首次打开会弹出设置窗口，填入 Gateway 地址后点保存即可使用

---

## 常见问题

**Q：脚本运行到一半报错了怎么办？**
截图错误信息发给技术负责人，或重新双击运行一次（大多数情况下重跑可以恢复）。

**Q：安装 MSVC Build Tools 卡住不动？**
正常现象，安装包较大，耐心等待，不要关闭窗口。

**Q：提示「无法找到 winget」？**
打开微软应用商店，搜索「应用安装程序」安装更新后重试。Windows 11 通常自带，Windows 10 需手动更新。

**Q：编译报错 `error: linker 'link.exe' not found`？**
MSVC Build Tools 安装后需要重启电脑，重启后再运行脚本。

---

## 联系方式

如有问题，联系 Aiden（aiden@fluxvita.com）。
