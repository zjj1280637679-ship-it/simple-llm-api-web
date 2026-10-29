# 候选借用与验收

文档版本：0.1.0。修订 UTC：2026-10-29T11:07:00.000Z。

本库收藏可选择的实现与证据，不规定每个宿主都使用同一套模块。需求决定要得到的效果，条件描述当前环境，策略是可替换的实现/组合选择，指标用于判断这一次选择是否达到目标。暂未选定的策略或指标保留未知，不写成以后所有消费者的固定前提。

## 四个事件，分别留证

| 事件 | 需要记录的事实 | 不能据此推出 |
| --- | --- | --- |
| 入库 | 模块 ID/版本、唯一源码、契约、条件、局部证据和未知项 | 每个宿主都应依赖它 |
| 合并 | 目标分支、实际提交、检查结果及合并时间 | 候选已经被生产代码采用或部署 |
| 借用 | 消费者目标/条件、选用版本与依赖闭包、选择理由、消费者宿主及实验结果 | 新宿主、其他模型或整个组合也通过 |
| 生产接入 | 实际接线、部署身份、真实运行条件、目标效果与失败路径的验收 | 库内所有候选必须接入，或将来条件永远成立 |

上述记录可引用已有证据，不需要复制相同代码或制造多套流水线。当前没有自动完成这四项事件的统一程序；操作者根据具体项目保存 Git 提交、测试报告和运行观察。未合并的分支也可以做限定借用实验，但须固定其准确提交。未选用不等于失败或应删除。

## 借用一次所需的最小记录

- 需求：希望消费者达到什么效果，哪些场景本次不评价。
- 条件：运行时、输入类型、状态与副作用边界、依赖/资源版本、网络与凭据要求（如果有关）。
- 策略：候选 ID/版本/源码提交或 SHA-256、当前选用理由与替代方向。入口的导出名相同不证明替代实现等效。
- 指标：输入刺激、期望观察、错误与取消判据、消费者最简宿主 ID/版本/时间、真实/合成模式及实际结果。不能沿用一个不适用于新目标的旧阈值。

从契约及源码建立实际导入/运行依赖闭包。目录中的效果依赖不是完整打包清单：例如生产借用入口仍引用 src/；现有宿主报告还引用 support、目录及检查器。当前仓库未提供独立 npm 包或自动导出器，不能声称复制所有模块的 index 文件就能独立运行。

## 可离线复现的单模块借用示例

此例只选 **F-004 fixture 请求契约**。它的实现文件无相对导入，使用 Node 内置功能；复制它不需要整个生产网页。消费者自行提供一个临时最简宿主，验证参数绑定、输入不变、精确匹配和错配错误。它不是替换或升级库内 H-F-004，也不把结果写成整个模块契约的证明。

在准确源码快照的仓库根目录执行以下命令。需要 Node.js 20+；本轮实测版本见报告。命令不安装包、不读取真实密钥、不发 API 请求；只在系统临时目录创建并随后删除示例文件。实现使用的 Headers/structuredClone 由运行时提供。

```sh
BORROW_DIR="$(mktemp -d)"; export BORROW_DIR
trap 'rm -rf "$BORROW_DIR"' EXIT
cp module-library/functions/fixture-contract/index.js "$BORROW_DIR/index.mjs"
cp module-library/functions/fixture-contract/CONTRACT.md "$BORROW_DIR/CONTRACT.md"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const startedAt=new Date().toISOString();
const entry=process.env.BORROW_DIR+'/index.mjs';
const {bindFixtureSteps,assertFixtureRequest,SimulatorError}=await import(pathToFileURL(entry));
let attempts=0;
globalThis.fetch=()=>{attempts++;throw Error('No network expected in this local example');};
const fixture={parameters:{prompt:{type:'string',default:'hello'}},steps:[{
  request:{method:'POST',url:'https://fixture.invalid/local',
    headers:{'content-type':'application/json'},body:{prompt:{$parameter:'prompt'}}}}]};
const before=structuredClone(fixture);
const expected=bindFixtureSteps(fixture,{prompt:'consumer'})[0].request;
assert.equal(expected.body.prompt,'consumer');
assert.deepEqual(fixture,before);
const actual={...expected,headers:new Headers(expected.headers)};
assert.equal(assertFixtureRequest(actual,expected),undefined);
assert.throws(()=>assertFixtureRequest({...actual,body:{prompt:'other'}},expected),
  e=>e instanceof SimulatorError && e.code==='SIMULATOR_REQUEST_MISMATCH');
assert.throws(()=>bindFixtureSteps(fixture,{unknown:'x'}),e=>e.code==='SIMULATOR_CONFIGURATION');
assert.equal(attempts,0);
console.log(JSON.stringify({status:'PASS',evidenceType:'LOCAL',node:process.version,
  consumerHost:{id:'example-borrow-F004',version:'0.1.0',createdAt:'2026-10-29T11:07:00.000Z'},
  sourceSha256:createHash('sha256').update(await readFile(entry)).digest('hex'),
  assertions:6,fetchAttempts:attempts,startedAt,finishedAt:new Date().toISOString(),
  scope:'single borrowed implementation; not full contract, production, or formal proof'},null,2));
NODE
```

`fetch` 断言用于发现此例中的误调用，不是对任意代码的网络沙箱保证。这个消费者宿主没有库内版本登记/证据失效器，复跑者应保存输出及来源提交，源码变化后重新验证。文件名改为 .mjs 只显式选择 ESM 解析，文件字节与 SHA-256 不变。

需要复核库内宿主时，在完整源码快照另行运行 `npm run modules:host -- F-004`。该命令与上述消费者实验是两份不同证据：前者覆盖库内宿主登记和声明观察，后者只表明选定实现可在这个离线消费者最小环境执行。其他模块要按各自依赖和目标重新设计实验，不从 F-004 的结果类推。

## 发现不适用时

将原因落到目标不匹配、条件不成立、候选实现缺陷或关系/组合问题，再选择补条件、换候选、修模块或改变组合。保留原实验和反例；不把“本次未采用”写成普遍禁止，也不因一个消费者受阻而停止无关模块的工作。
