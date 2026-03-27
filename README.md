# Go Smart Test Varname

在 Go 代码里输入 `Demo().` 时，提供一个 `ai` 补全项。选中后会把调用表达式替换为变量声明，例如：

```go
func TestAA(t *testing.T) {
    Demo().
}
```

补全后可变为：

```go
func TestAA(t *testing.T) {
    demo, err := Demo()
}
```

特性：

- 根据函数返回值个数自动生成变量名
- `error` 返回值固定命名为 `err`
- 常见函数名前缀优先本地命名，减少等待时间
- 优先使用 AI 生成非 `error` 返回值名称
- AI 不可用时自动回退到本地规则命名
- 默认只在 `*_test.go` 中启用

本地规则示例：

- `GetUser() (*User, error)` -> `user, err`
- `ListUsers() ([]User, error)` -> `users, err`
- `ParseConfig() (*Config, error)` -> `config, err`
- `CountUsers() (int, error)` -> `count, err`
- `HasPermission() (bool, error)` -> `hasPermission, err`
- `ExistsUser() (bool, error)` -> `userExists, err`

## 配置

- `goSmartTestVarname.ai.enabled`: 是否启用 AI
- `goSmartTestVarname.openai.baseURL`: OpenAI 兼容接口地址
- `goSmartTestVarname.openai.key`: API Key
- `goSmartTestVarname.openai.modelID`: 模型 ID
- `goSmartTestVarname.openai.systemPrompt`: 系统提示词
- `goSmartTestVarname.openai.temperature`: 采样温度
- `goSmartTestVarname.openai.stream`: 是否启用流式返回
- `goSmartTestVarname.ai.timeoutMs`: 超时时间
- `goSmartTestVarname.onlyInTestFiles`: 是否仅在测试文件启用

## 调试

直接用 VS Code 打开本目录，按 `F5` 启动扩展开发宿主。
