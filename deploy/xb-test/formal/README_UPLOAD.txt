小宝管家 V1.2.0 | P0 登录交互与恢复体验 | 腾讯云 CloudBase 静态托管包
源代码 Feature SHA: 4117f41051371b2296c61e0d7f7f571fa2a99960
本包使用原腾讯云环境和原已成功的公开前端登录配置，不更换 CloudBase。
上传目标：原测试网站的 /xb-test/formal/
请从 ZIP 中直接选择以下三个文件，覆盖目标目录内同名文件：
1. index.html
2. m1-controller.js
3. formal-controller.js
README_UPLOAD.txt 仅供本地阅读，无需上传。

要求目标目录的结构：
/xb-test/formal/index.html
/xb-test/formal/m1-controller.js
/xb-test/formal/formal-controller.js

上传后在原腾讯云测试域名访问：
https://<原腾讯云静态托管域名>/xb-test/formal/?p0=4117f41
不要使用 Cloudflare 或其他新的域名。

F12 Console 运行（不发送网络写入）：
console.log(document.querySelector('meta[name="xiaobao-p0-source-sha"]')?.content);
console.table([...document.scripts].filter(s=>s.src).map(s=>({url:s.src})));
预期 meta SHA 为 4117f41051371b2296c61e0d7f7f571fa2a99960。
预期两个脚本路径：
/xb-test/formal/m1-controller.js?v=4117f41
/xb-test/formal/formal-controller.js?v=4117f41

Network > Disable cache, Ctrl+Shift+R, 核验这两个脚本都为 HTTP 200。
不要清空站点本地数据/IndexedDB，也不要恢复 V1.1.2 写入。
P0 的真实验收：错误验证码保留输入与按钮恢复；正确验证码进入五页面；
主动退出后刷新显示登录；已有会话刷新/标签切换不会长期 boot；
夫妻分别登录只能看到同一正式 primary、没有 S140 测试宝宝数据。
真实浏览器操作未在本包创建过程中执行，只有你验收后才能判定 PASS。
FORMAL_WRITE_ENABLED=false，禁止采购/库存真实写入。
