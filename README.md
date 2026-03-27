# Smart Return Names

一个用于“函数返回值自动命名”的 VS Code 扩展。

你只需要在函数调用后输入 `.`，选择补全面板中的 `ai`，扩展就会自动把当前调用改写成变量声明，并尽量生成更合适的变量名。

## 这个扩展解决什么问题

很多时候我们写代码会遇到这种场景：

- 函数有返回值，但编辑器生成的变量名太泛
- 需要自己手动改名，打断编码节奏
- 想借助 AI，又不希望每次都等待很久

Smart Return Names 采用的是“本地规则优先，AI 兜底增强”的策略：

- 常见命名模式优先本地秒出结果
- 只有本地规则不够确定时才调用 AI
- 自动规避非法变量名、关键字和明显不合理的命名

这样既保留了 AI 的语义能力，也尽量保证了日常使用时的速度和稳定性。

## 如何使用

1. 写下一个函数调用，例如 `Demo().`
2. 在补全面板中选择 `ai`
3. 扩展会解析函数签名
4. 生成返回值变量名
5. 自动改写为当前语言对应的变量声明

执行时右下角会有进度提示，方便你知道扩展正在工作。

## 使用示例

### Go

改写前：

```go
func TestDemo(t *testing.T) {
    Demo().
}
```

改写后：

```go
func TestDemo(t *testing.T) {
    demo, err := Demo()
}
```

### TypeScript

改写前：

```ts
getUser().
```

改写后：

```ts
const user = getUser()
```

### React / TSX

改写前：

```tsx
loadProfile().
```

改写后：

```tsx
const profile = loadProfile()
```

### Python

改写前：

```python
load_config().
```

改写后：

```python
config = load_config()
```

## 本地命名规则

扩展会优先尝试使用确定性的本地规则，而不是一上来就调用 AI。

例如：

- `GetUser() (*User, error)` -> `user, err`
- `ListUsers() ([]User, error)` -> `users, err`
- `ParseConfig() (*Config, error)` -> `config, err`
- `CountUsers() (int, error)` -> `count, err`
- `HasPermission() (bool, error)` -> `hasPermission, err`
- `ExistsUser() (bool, error)` -> `userExists, err`

另外还会自动处理这些问题：

- `error` 固定映射为 `err`
- 避免使用 `string`、`int`、`bool`、`nil`、`true`、`false` 等保留标识符
- 自动清理非法变量名
- 如果出现重名，会自动追加后缀避免冲突

## 当前支持的语言

目前已经接入的主要语言可以按场景理解：

### Web / 前端

- JavaScript
- TypeScript
- React JSX
- React TSX
- Vue

### 后端 / 通用开发

- Go
- Python
- Rust
- Java
- C#

### 其他语言

- PHP
- Ruby
- Lua
- Kotlin
- Swift
- Dart
- C
- C++

说明：

- 当前 Go 的支持最完整
- `onlyInTestFiles` 这个配置只对 Go 生效，适合 `_test.go` 场景
- 动态语言在签名无法准确推断时，可能会退化为单返回值命名

## 按语言写入变量声明

扩展会根据当前语言自动选择合适的赋值语法。

例如：

- Go：`user, err := getUser()`
- TypeScript：`const user = getUser()`
- JavaScript 多返回值风格：`const [value, error] = fn()`
- Python：`value, err = fn()`
- Rust：`let value = fn();`
- Kotlin：`val value = fn()`

## AI 命名策略

AI 不是主路径，而是增强路径。

启用 AI 后，扩展会：

- 先走本地规则
- 只在低置信度场景请求 AI
- 支持流式返回
- 如果 AI 超时或失败，自动回退到本地规则结果

这意味着它不会把每一次编辑都变成一次重度远程请求。

## 配置项

为了兼容历史版本，当前配置键仍然沿用旧前缀 `goSmartTestVarname.*`。

- `goSmartTestVarname.ai.enabled`
  是否启用 AI 命名
- `goSmartTestVarname.openai.baseURL`
  OpenAI 兼容接口地址
- `goSmartTestVarname.openai.key`
  API Key
- `goSmartTestVarname.openai.modelID`
  模型 ID
- `goSmartTestVarname.openai.systemPrompt`
  发送给模型的系统提示词
- `goSmartTestVarname.openai.temperature`
  采样温度
- `goSmartTestVarname.openai.stream`
  是否启用流式返回
- `goSmartTestVarname.ai.timeoutMs`
  AI 请求超时时间，单位毫秒
- `goSmartTestVarname.onlyInTestFiles`
  是否只在 Go 的 `_test.go` 文件中启用

配置示例：

```json
{
  "goSmartTestVarname.ai.enabled": true,
  "goSmartTestVarname.openai.baseURL": "https://api.openai.com/v1",
  "goSmartTestVarname.openai.key": "你的 API Key",
  "goSmartTestVarname.openai.modelID": "gpt-4o-mini",
  "goSmartTestVarname.openai.stream": true,
  "goSmartTestVarname.ai.timeoutMs": 1500
}
```

## 已知限制

- 返回值推断质量依赖编辑器提供的“跳转到定义 / 定义解析”能力
- 当前 Go 的规则支持最深
- 某些语言在复杂函数签名下仍可能只能推断出单个返回值
- AI 命名本质上仍然是启发式过程，不保证每次都完全符合你的个人命名习惯

## 上架素材

当前扩展已补齐这些商店相关内容：

- 扩展图标
- 变更日志
- 支持文档
- 许可证
- 仓库地址与问题反馈入口

## 反馈与建议

问题反馈与功能建议：

<https://github.com/loveyu233/go-smart-test-varname/issues>

项目地址：

<https://github.com/loveyu233/go-smart-test-varname>
