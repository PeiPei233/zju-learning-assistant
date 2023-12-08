# zju-learning-assistant

帮你快速下载所有课件😋

## 特性

- 支持 Windows、Linux、Mac
- 批量下载课件
- 支持下载老师未开放下载的课件
- 支持从智云下载 PPT 并导出为 PDF
- 跟随系统暗黑模式

## 开始

P.S. 由于没有购买 CA 签名，本软件没有签名，因此下载、安装、运行过程中可能会被系统拦截，请信任本软件或自行编译。

### 下载安装

从 [Release](https://github.com/PeiPei233/zju-learning-assistant/releases) 下载对应系统的最新版本，安装后打开即可。
- Windows 用户可下载 `.exe` `.msi` 文件进行安装。
- Linux 用户可下载 `.AppImage` 文件，赋予可执行权限后运行。或者下载 `.deb` 文件进行安装。
- Mac 用户可下载 `.dmg` 文件进行安装。

### 自行编译

1. 安装 [Node.js](https://nodejs.org/en/) 和 npm
2. 安装 [Rust](https://www.rust-lang.org/tools/install)
3. 克隆本仓库
4. Linux 用户请使用 `sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf` 安装依赖
5. 运行 `npm install` 安装依赖
6. 运行 `cargo install tauri-cli` 安装 Tauri
7. 运行 `cargo tauri build` 编译，编译后的文件在 `src-tauri/target/release` 目录下

## 使用手册

打开软件后，请先用本人的浙大统一身份认证登录，即输入登录学在浙大时的学号、密码，登陆成功后才能下载课件。

![Login Page](assets/login.png)

此界面点击右上角可查看版本信息、检查是否有新版。

登陆后进入以下下载课件的界面。

![Course Page](assets/learning.png)

上方可选择从学在浙大或智云课堂下载课件。

当选择学在浙大时，可选择学年和学期来筛选课程。选中课程后点击右侧的刷新按钮获取所选课程的可见列表。

点击刷新按钮旁的编辑按钮可修改下载课件时的保存路径（ Mac 用户务必做此操作，否则会报错下载失败），点击打开文件夹按钮可打开下载文件保存的文件夹。

选择完所需的课件，点击下载课件按钮开始下载课件，等待即可。下载过程中可点击取消下载按钮取消下载，此时已下载的课程会自动从课件列表中移除。

![Classroom Page](assets/classroom.png)

当选择智云课堂时，可按日期选择课堂。选中课堂后点击右侧的刷新按钮获取所选课堂的课件列表。

当选中 `导出为 PDF` 复选框时，会将课件的图片整合成一份 PDF 文件并保存。

其他功能与学在浙大相同。

## 我的信息是否安全？

本软件实质上是一个爬虫，模拟登录学在浙大、获取课件列表、下载课件的过程。因此，本软件需要你的学号、密码才能正常运行。

本软件不会将你的学号、密码上传到任何服务器，也不会将你的学号、密码保存到本地。你可以查看源代码来确认这一点。在使用过程中，本软件只会访问以下网站：

- `zju.edu.cn`：用于登录学在浙大、获取课件列表、下载课件
- `api.github.com`：用于检查更新
- `fonts.googleapis.com`：用于下载字体

## 为什么要开发这个软件？

![Rewrite in Rust!](assets/rust.png)

**Rewrite in Rust!**

之前 QSC 坏掉的时候自己用爬虫写了个计算绩点的 Python 脚本，后来 QSC 修好了，就用它做了个[成绩更新的钉钉机器人推送](https://github.com/PeiPei233/zju-score-push-template)。奈何 Python 做 GUI 打包分发太过于麻烦，于是想着换个语言重写一下爬虫脚本。近日，一位友人想要我把 myc 的计算理论作业和答案全部下载打包给 TA 用于复习 jxg 的小测，联想到之前 n+e 学长做过一个 [清华大学新版网络学堂课程自动下载脚本](https://github.com/Trinkle23897/learn2018-autodown)，于是就想着写一个类似的软件。经过一顿摸索之后发现 Rust + Tauri 这个组合非常好用，至少 Rust 的爬虫比 Node.js 的爬虫好用很多，接近 Python 的爬虫体验了，于是放弃 Electron 转投 Tauri。

## To-Do List

- ✅ 批量下载导出智云课堂 PPT
- 多线程并行获取列表优化
- 删除文件名后多余的 (1) 等无用后缀
- 优化前端（课件筛选搜索等等）
- 增量下载
- 后台持续检测课件更新
