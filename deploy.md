# ChainLancer 部署指南

> 目标网络：**Base Sepolia**（Chain ID 84532）  
> 前端托管：**Azure Static Web Apps**（域名 `www.cyng268.app`）  
> 代码仓库：`github.com/Michael-wzl/ChainLancer`，分支 `main`

---

## 第一部分：准备工作

### 1.1 获取 Base Sepolia 测试 ETH

部署合约需要支付 gas 费，必须先在钱包中获取 Base Sepolia 测试 ETH。

1. 打开 MetaMask，切换到 **Base Sepolia** 网络。如果网络列表中没有，手动添加：
   - 网络名称：`Base Sepolia`
   - RPC URL：`https://sepolia.base.org`
   - Chain ID：`84532`
   - 货币符号：`ETH`
2. 复制你的钱包地址。
3. 前往[Superchain Faucet](https://app.optimism.io/faucet)水龙头领取测试 ETH。需 GitHub 账号验证，支持 Base Sepolia。
4. 粘贴钱包地址并领取，通常 1-2 分钟到账。

### 1.2 导出部署用私钥

1. 打开 MetaMask → 点击账户右侧 `⋮` → **Account details** → **Show private key**。
2. 输入 MetaMask 密码，复制私钥（格式为 `0xabcdef1234...`，64位十六进制）。
3. ⚠️ **保管好这个私钥，绝对不能提交到 Git 仓库。**

### 1.3 获取 BaseScan API Key（用于合约源码验证）

1. 前往 <https://basescan.org>，右上角注册或登录账号。
2. 登录后，点击右上角用户名 → **My Account** → **API Keys**。
3. 点击 **Add** → 输入任意名称（如 `ChainLancer`）→ 确认创建。
4. 复制生成的 API Key Token（格式为一段大写字母+数字的字符串）。

---

## 第二部分：部署智能合约到 Base Sepolia

### 2.1 创建根目录 `.env` 文件

在项目根目录创建 `.env` 文件（已被 `.gitignore` 忽略，不会提交到 Git）：

```dotenv
DEPLOYER_PRIVATE_KEY=0x你的私钥
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASESCAN_API_KEY=你的BaseScan_API_Key
```

### 2.2 安装依赖并编译合约

```bash
# 在项目根目录执行
npm install
npm run compile
```

确保输出中无报错，所有合约编译成功。

### 2.3 部署合约

```bash
npm run deploy:base-sepolia
```

脚本会依次部署 5 个合约，并自动完成跨合约角色授权配置。每笔链上交易需要等待区块确认，整体约需 1–5 分钟。

**成功后终端输出示例：**

```text
Deploying contracts with account: 0xYourAddress

1. Deploying MockUSDC...
   MockUSDC deployed to: 0xAAAA...

2. Deploying DataAvailability...
   DataAvailability deployed to: 0xBBBB...

3. Deploying Reputation...
   Reputation deployed to: 0xCCCC...

4. Deploying Dispute...
   Dispute deployed to: 0xDDDD...

5. Deploying JobEscrow...
   JobEscrow deployed to: 0xEEEE...

6. Configuring cross-references...
   ...

✅ All contracts deployed and configured!

── VITE ENV VARIABLES ──
VITE_MOCK_USDC_ADDRESS=0xAAAA...
VITE_JOB_ESCROW_ADDRESS=0xEEEE...
VITE_DISPUTE_ADDRESS=0xDDDD...
VITE_REPUTATION_ADDRESS=0xCCCC...
VITE_DATA_AVAILABILITY_ADDRESS=0xBBBB...
```

⚠️ **立即将终端输出的所有地址记录下来，后续步骤多处需要使用。** 特别是最后的 `── VITE ENV VARIABLES ──` 区块中的 5 个地址，以及 `Treasury` 和 `Platform Admin` 地址。

### 2.4 验证合约源码（发布到 BaseScan）

将部署输出的地址追加写入根目录 `.env` 文件：

```dotenv
USDC_ADDRESS=0xAAAA...（MockUSDC 地址）
DATA_AVAILABILITY_ADDRESS=0xBBBB...
REPUTATION_ADDRESS=0xCCCC...
DISPUTE_ADDRESS=0xDDDD...
JOB_ESCROW_ADDRESS=0xEEEE...
```

然后运行验证脚本：

```bash
npm run verify:base-sepolia
```

每个合约验证成功后显示 `✅ Verified`。显示 "Already Verified" 也属正常。

验证完成后，可在 BaseScan 上查看每个合约的完整源码：  
<https://sepolia.basescan.org/address/0x合约地址>

---

## 第三部分：配置 GitHub Secrets（CI/CD 所需）

### 3.1 获取 Azure Deployment Token

1. 登录 [Azure Portal](https://portal.azure.com)。
2. 导航到 **Static Web Apps** → 找到 `cyng268.app` 对应的应用。
3. 左侧菜单点击 **Overview** → 点击 **Manage deployment token**。
4. 复制该 token（以 `xxxxxxxx-xxxx-...` 格式开头的长字符串）。

### 3.2 在 GitHub 仓库中添加 Secrets

前往 [GitHub Secrets 设置页面](https://github.com/Michael-wzl/ChainLancer/settings/secrets/actions)，点击 **New repository secret**，依次添加以下 **8 个 Secrets**：

| Secret 名称 | 值 |
| --- | --- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | 步骤 3.1 中从 Azure 获取的 deployment token |
| `VITE_PINATA_JWT` | `frontend/.env` 中 `VITE_PINATA_JWT` 的当前值（完整 JWT 字符串） |
| `VITE_PINATA_GATEWAY_URL` | `https://gateway.pinata.cloud/ipfs` |
| `VITE_MOCK_USDC_ADDRESS` | 步骤 2.3 输出的 MockUSDC 地址 |
| `VITE_JOB_ESCROW_ADDRESS` | 步骤 2.3 输出的 JobEscrow 地址 |
| `VITE_DISPUTE_ADDRESS` | 步骤 2.3 输出的 Dispute 地址 |
| `VITE_REPUTATION_ADDRESS` | 步骤 2.3 输出的 Reputation 地址 |
| `VITE_DATA_AVAILABILITY_ADDRESS` | 步骤 2.3 输出的 DataAvailability 地址 |

> 如果 `AZURE_STATIC_WEB_APPS_API_TOKEN` 已存在（之前部署旧版本时设置过），点击 **Update** 确认其值与 Azure 最新 token 一致。

---

## 第四部分：推送代码触发自动部署

### 4.1 确认 `.env` 文件不会被提交

在提交前，确认 `git status` 中不包含任何 `.env` 文件：

```bash
git status
```

如果看到 `.env` 或 `frontend/.env` 出现在暂存区，立即执行：

```bash
git reset HEAD .env
git reset HEAD frontend/.env
```

### 4.2 暂存并提交所有变更

```bash
git add -A
git commit -m "feat: prepare for Base Sepolia testnet deployment"
```

### 4.3 推送到 GitHub（自动触发 Azure 部署）

```bash
git push origin main
```

推送完成后，GitHub Actions 会立即自动触发构建和部署流水线。

### 4.4 监控部署进度

1. 前往 [GitHub Actions 页面](https://github.com/Michael-wzl/ChainLancer/actions)。
2. 找到最新的 **"Deploy Azure Static Web App"** workflow run，点击进入。
3. 查看 **"Build and Deploy Job"** 步骤的日志，等待绿色 ✅ 出现。
4. 整体耗时通常为 **2–5 分钟**。

**常见失败原因及排查：**

| 错误现象 | 原因 | 解决方法 |
| --- | --- | --- |
| `Authorization failed` | `AZURE_STATIC_WEB_APPS_API_TOKEN` 失效或未设置 | 去 Azure Portal 重新获取 token，更新 Secret |
| `npm install` 失败 | `package-lock.json` 与 `package.json` 不一致 | 本地 `npm install` 后重新提交 |
| `Build failed: TypeScript error` | TypeScript 编译错误 | 根据日志修复错误后重新提交 |
| Secrets 为空（地址显示为空字符串） | GitHub Secret 名称拼写错误 | 检查 Secret 名称与 workflow 中的 `env` 块完全一致 |

---

## 第五部分：验证部署结果

### 5.1 验证前端页面

1. 打开 <https://www.cyng268.app>。
2. 确认 ChainLancer Dashboard 正常加载，无白屏或报错。
3. 打开浏览器 DevTools → **Console** 面板，确认无 CSP 违规错误（红色报错中含 `Content-Security-Policy`）。

### 5.2 验证钱包连接与网络

1. 打开 MetaMask，切换到 **Base Sepolia** 网络。
2. 点击 "Connect Wallet"，授权连接。
3. 导航栏右上角应显示绿色 **"Base Sepolia"** 标签。
4. 如果使用其他网络连接，应出现红色 **"Switch to Base Sepolia"** 按钮，点击后 MetaMask 弹出切换网络确认，点击确认即可。

### 5.3 验证 Testnet Faucet（Mint MockUSDC）

1. 连接钱包后，前往 **Dashboard** 或 **Wallet** 页面。
2. 页面底部应出现 **"Testnet Faucet"** 面板（紫色渐变卡片）。
3. 输入金额（如 `10000`），点击 **Mint**。
4. MetaMask 弹出交易确认 → 点击确认。
5. 等待交易打包（约 5–15 秒），USDC 余额应增加。

### 5.4 验证 TimeTravelPanel 已被禁用

1. 页面右下角**不应出现** ⏳ 浮动按钮。
2. 打开 DevTools → **Network** 面板，刷新页面，确认网络请求中没有加载名为 `TimeTravelPanel-*.js` 的 chunk。

### 5.5 验证合约源码（BaseScan）

1. 打开 <https://sepolia.basescan.org>。
2. 在搜索框中输入任一合约地址（如 JobEscrow 地址）。
3. 进入合约页面 → 点击 **Contract** 标签。
4. 应显示绿色 ✅ **"Verified"** 标记，并可查看完整 Solidity 源码。

---

## 第六部分：部署后配置（按需）

### 6.1 分配 Judge / Admin 角色给其他钱包

1. 用部署者钱包登录 <https://www.cyng268.app/admin>。
2. 切换到 **"Role Management"** tab。
3. 输入目标钱包地址和角色名称，点击 **Grant**，在 MetaMask 中确认交易。

### 6.2 更新本地 `frontend/.env` 用于 Base Sepolia 开发

如需在本地连接 Base Sepolia 进行调试，将 `frontend/.env` 更新为：

```dotenv
VITE_PINATA_JWT=你的Pinata_JWT
VITE_PINATA_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
VITE_TARGET_NETWORK=base-sepolia
# VITE_TEST_MODE=true  ← 必须注释掉或删除
VITE_MOCK_USDC_ADDRESS=0xAAAA...
VITE_JOB_ESCROW_ADDRESS=0xEEEE...
VITE_DISPUTE_ADDRESS=0xDDDD...
VITE_REPUTATION_ADDRESS=0xCCCC...
VITE_DATA_AVAILABILITY_ADDRESS=0xBBBB...
```

如需切回本地 Hardhat 开发（用于跑测试、时间旅行等），恢复为：

```dotenv
VITE_TARGET_NETWORK=hardhat
VITE_TEST_MODE=true
VITE_MOCK_USDC_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
VITE_JOB_ESCROW_ADDRESS=0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
VITE_DISPUTE_ADDRESS=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
VITE_REPUTATION_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
VITE_DATA_AVAILABILITY_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
```

---

## 命令速查表

| 操作 | 命令（在项目根目录执行） |
| --- | --- |
| 安装依赖 | `npm install` |
| 编译合约 | `npm run compile` |
| 本地部署（Hardhat） | `npm run deploy:local` |
| 部署到 Base Sepolia | `npm run deploy:base-sepolia` |
| 验证合约源码 | `npm run verify:base-sepolia` |
| 本地前端开发 | `cd frontend && npm run dev` |
| 前端生产构建测试 | `cd frontend && npx vite build` |
| 提交并推送（触发 Azure 自动部署） | `git add -A && git commit -m "msg" && git push origin main` |
