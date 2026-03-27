const vscode = require("vscode");

function activate(context) {
  const provider = new GoSmartReturnNameCompletionProvider(context);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "go", scheme: "file" },
      provider,
      "."
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "goSmartTestVarname.applyAiCompletion",
      applyAiCompletion
    )
  );
}

class GoSmartReturnNameCompletionProvider {
  constructor(context) {
    this.context = context;
  }

  provideCompletionItems(document, position) {
    if (!shouldProvideForDocument(document)) {
      return undefined;
    }

    const callSite = extractCallSite(document, position);
    if (!callSite) {
      return undefined;
    }

    const item = new vscode.CompletionItem(
      "ai",
      vscode.CompletionItemKind.Snippet
    );
    item.detail = "AI 生成返回值变量名";
    item.documentation = new vscode.MarkdownString(
      `将 \`${callSite.callExpression}\` 展开为变量声明`
    );
    item.range = new vscode.Range(position, position);
    item.insertText = "ai";
    item.sortText = "\u0000";
    item.filterText = "ai";
    item.preselect = true;
    item.command = {
      command: "goSmartTestVarname.applyAiCompletion",
      title: "应用 AI 返回值命名",
      arguments: [serializeCallSite(document, callSite)]
    };
    return [item];
  }
}

function deactivate() {}

async function applyAiCompletion(serializedCallSite) {
  if (!serializedCallSite?.uri) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Go Smart Test Varname 正在生成变量名",
      cancellable: false
    },
    async (progress) => {
      try {
        progress.report({ message: "正在解析函数签名..." });
        const uri = vscode.Uri.parse(serializedCallSite.uri);
        const document = await vscode.workspace.openTextDocument(uri);
        const callSite = deserializeCallSite(serializedCallSite);
        const signatureInfo = await resolveFunctionSignature(document, callSite);
        if (!signatureInfo || !signatureInfo.returns.length) {
          vscode.window.showWarningMessage("未能解析函数返回值，无法生成变量名。");
          return;
        }

        progress.report({ message: "正在生成变量名..." });
        const names = await suggestVariableNames({
          signatureInfo,
          callExpression: callSite.callExpression
        });
        if (!names || names.length !== signatureInfo.returns.length) {
          vscode.window.showWarningMessage("生成变量名失败，请检查函数签名或 AI 配置。");
          return;
        }

        progress.report({ message: "正在写入代码..." });
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          uri,
          callSite.acceptedRange || callSite.replaceRange,
          `${names.join(", ")} := ${callSite.callExpression}`
        );
        await vscode.workspace.applyEdit(edit);
      } catch (error) {
        console.error("go-smart-test-varname apply failed:", error);
        vscode.window.showErrorMessage(
          `Go Smart Test Varname 执行失败：${error?.message || String(error)}`
        );
      }
    }
  );
}

function shouldProvideForDocument(document) {
  const config = vscode.workspace.getConfiguration("goSmartTestVarname");
  if (!config.get("onlyInTestFiles", true)) {
    return true;
  }
  return document.fileName.endsWith("_test.go");
}

function extractCallSite(document, position) {
  if (position.character === 0) {
    return null;
  }

  const line = document.lineAt(position.line).text;
  const beforeCursor = line.slice(0, position.character);
  if (!beforeCursor.endsWith(".")) {
    return null;
  }

  const callEnd = beforeCursor.length - 2;
  if (callEnd < 0 || beforeCursor[callEnd] !== ")") {
    return null;
  }

  let depth = 0;
  let openParen = -1;
  for (let i = callEnd; i >= 0; i -= 1) {
    const ch = beforeCursor[i];
    if (ch === ")") {
      depth += 1;
    } else if (ch === "(") {
      depth -= 1;
      if (depth === 0) {
        openParen = i;
        break;
      }
    }
  }
  if (openParen < 0) {
    return null;
  }

  let start = openParen - 1;
  while (start >= 0 && /[\w.]/.test(beforeCursor[start])) {
    start -= 1;
  }
  start += 1;
  if (start >= openParen) {
    return null;
  }

  const callExpression = beforeCursor.slice(start, beforeCursor.length - 1);
  if (!callExpression) {
    return null;
  }

  let nameEnd = openParen;
  let nameStartIndex = openParen - 1;
  while (nameStartIndex >= start && /[A-Za-z0-9_]/.test(beforeCursor[nameStartIndex])) {
    nameStartIndex -= 1;
  }
  nameStartIndex += 1;
  const name = beforeCursor.slice(nameStartIndex, nameEnd);
  if (!name) {
    return null;
  }

  const replaceRange = new vscode.Range(
    new vscode.Position(position.line, start),
    position
  );
  const nameRange = new vscode.Range(
    new vscode.Position(position.line, nameStartIndex),
    new vscode.Position(position.line, nameStartIndex + name.length)
  );

  return {
    callExpression,
    functionName: name,
    replaceRange,
    nameRange
  };
}

function serializeCallSite(document, callSite) {
  return {
    uri: document.uri.toString(),
    callExpression: callSite.callExpression,
    functionName: callSite.functionName,
    replaceRange: serializeRange(callSite.replaceRange),
    acceptedRange: serializeRange(buildAcceptedRange(callSite.replaceRange)),
    nameRange: serializeRange(callSite.nameRange)
  };
}

function deserializeCallSite(value) {
  return {
    callExpression: value.callExpression,
    functionName: value.functionName,
    replaceRange: deserializeRange(value.replaceRange),
    acceptedRange: deserializeRange(value.acceptedRange),
    nameRange: deserializeRange(value.nameRange)
  };
}

function buildAcceptedRange(replaceRange) {
  return new vscode.Range(
    replaceRange.start,
    new vscode.Position(
      replaceRange.end.line,
      replaceRange.end.character + 2
    )
  );
}

function serializeRange(range) {
  return {
    start: {
      line: range.start.line,
      character: range.start.character
    },
    end: {
      line: range.end.line,
      character: range.end.character
    }
  };
}

function deserializeRange(value) {
  return new vscode.Range(
    new vscode.Position(value.start.line, value.start.character),
    new vscode.Position(value.end.line, value.end.character)
  );
}

async function resolveFunctionSignature(document, callSite) {
  const definitions = await vscode.commands.executeCommand(
    "vscode.executeDefinitionProvider",
    document.uri,
    callSite.nameRange.start
  );
  if (!definitions || definitions.length === 0) {
    return null;
  }

  const definition = definitions[0];
  const uri = definition.targetUri || definition.uri;
  const range = definition.targetSelectionRange || definition.range;
  if (!uri || !range) {
    return null;
  }

  const defDoc = await vscode.workspace.openTextDocument(uri);
  const signatureText = readFunctionSignature(defDoc, range.start.line);
  if (!signatureText) {
    return null;
  }

  const parsed = parseFunctionSignature(signatureText);
  if (!parsed) {
    return null;
  }

  return {
    functionName: parsed.name || callSite.functionName,
    signatureText,
    returns: parsed.returns
  };
}

function readFunctionSignature(document, startLine) {
  let combined = "";
  let braceDepth = 0;
  let sawFunc = false;

  for (let i = startLine; i < Math.min(document.lineCount, startLine + 30); i += 1) {
    const line = document.lineAt(i).text;
    combined += `${line}\n`;
    if (line.includes("func ")) {
      sawFunc = true;
    }
    for (const ch of line) {
      if (ch === "{") {
        braceDepth += 1;
      } else if (ch === "}") {
        braceDepth -= 1;
      }
    }
    if (sawFunc && braceDepth > 0) {
      break;
    }
  }

  const braceIndex = combined.indexOf("{");
  if (braceIndex >= 0) {
    return combined.slice(0, braceIndex).trim();
  }
  return combined.trim();
}

function parseFunctionSignature(signatureText) {
  const funcIndex = signatureText.indexOf("func ");
  if (funcIndex < 0) {
    return null;
  }

  let i = funcIndex + "func ".length;
  i = skipSpaces(signatureText, i);

  if (signatureText[i] === "(") {
    i = findMatchingParen(signatureText, i);
    if (i < 0) {
      return null;
    }
    i += 1;
    i = skipSpaces(signatureText, i);
  }

  const nameStart = i;
  while (i < signatureText.length && /[A-Za-z0-9_]/.test(signatureText[i])) {
    i += 1;
  }
  const name = signatureText.slice(nameStart, i);
  i = skipSpaces(signatureText, i);

  if (signatureText[i] !== "(") {
    return null;
  }
  i = findMatchingParen(signatureText, i);
  if (i < 0) {
    return null;
  }
  i += 1;
  i = skipSpaces(signatureText, i);

  if (i >= signatureText.length) {
    return { name, returns: [] };
  }

  let returnSpec = signatureText.slice(i).trim();
  if (!returnSpec) {
    return { name, returns: [] };
  }

  if (returnSpec.startsWith("(")) {
    const end = findMatchingParen(returnSpec, 0);
    if (end < 0) {
      return null;
    }
    returnSpec = returnSpec.slice(1, end).trim();
    return {
      name,
      returns: parseReturnFields(returnSpec)
    };
  }

  return {
    name,
    returns: parseReturnFields(returnSpec)
  };
}

function parseReturnFields(returnSpec) {
  const parts = splitTopLevel(returnSpec, ",");
  return parts
    .map((part) => parseReturnField(part.trim()))
    .filter(Boolean);
}

function parseReturnField(fieldText) {
  if (!fieldText) {
    return null;
  }

  const tokens = fieldText.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    const type = tokens[0];
    return { name: "", type, isError: isErrorType(type) };
  }

  const lastToken = tokens[tokens.length - 1];
  const leading = tokens.slice(0, -1);
  const allIdentifiers = leading.every((token) => /^[A-Za-z_]\w*$/.test(token));
  if (!allIdentifiers) {
    return { name: "", type: fieldText, isError: isErrorType(fieldText) };
  }

  return leading.map((name) => ({
    name,
    type: lastToken,
    isError: isErrorType(lastToken)
  }));
}

async function suggestVariableNames(input) {
  const returns = flattenReturns(input.signatureInfo.returns);
  const localPlans = returns.map((item, index) =>
    buildLocalNamePlan({
      functionName: input.signatureInfo.functionName,
      item,
      index,
      total: returns.length
    })
  );
  const aiTargets = localPlans.filter(shouldAskAiForLocalName);
  const config = vscode.workspace.getConfiguration("goSmartTestVarname");

  let aiNames = [];
  if (config.get("ai.enabled", false) && aiTargets.length > 0) {
    try {
      aiNames = await requestAiVariableNames({
        functionName: input.signatureInfo.functionName,
        signatureText: input.signatureInfo.signatureText,
        callExpression: input.callExpression,
        returns: aiTargets.map((plan) => plan.item)
      });
    } catch (error) {
      console.warn("go-smart-test-varname AI fallback:", error);
    }
  }

  const used = new Set();
  let aiIndex = 0;
  return localPlans.map((plan) => {
    let candidate = plan.name;
    if (shouldAskAiForLocalName(plan) && aiNames[aiIndex]) {
      candidate = toCamelName(aiNames[aiIndex]);
      aiIndex += 1;
    }
    return makeUniqueName(candidate, used);
  });
}

async function requestAiVariableNames(payload) {
  const config = vscode.workspace.getConfiguration("goSmartTestVarname");
  const baseUrl = config.get("openai.baseURL", "");
  const apiKey = config.get("openai.key", "");
  const model = config.get("openai.modelID", "gpt-4o-mini");
  const systemPrompt = config.get("openai.systemPrompt", "你是一个严谨的 Go 命名助手。");
  const temperature = config.get("openai.temperature", 0.1);
  const stream = config.get("openai.stream", true);
  const timeoutMs = config.get("ai.timeoutMs", 6000);
  const requestUrl = buildChatCompletionsUrl(baseUrl);

  if (!requestUrl || !apiKey || typeof fetch !== "function") {
    return [];
  }

  const prompt = [
    "你是 Go 变量命名助手。",
    "任务：根据函数签名和调用表达式，只为非 error 返回值生成最合适的 Go 局部变量名。",
    "约束：",
    "1. 只返回 JSON 数组，不要 Markdown，不要解释。",
    "2. 名称必须是小驼峰或简短 Go 风格名称。",
    "3. 不要返回 err，error 由调用方固定命名为 err。",
    "4. 名称数量必须等于非 error 返回值数量。",
    `函数签名：${payload.signatureText}`,
    `调用表达式：${payload.callExpression}`,
    `非 error 返回值：${JSON.stringify(payload.returns)}`
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: stream ? "text/event-stream, application/json" : "application/json"
      },
      body: JSON.stringify({
        model,
        temperature,
        stream,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`AI 请求失败: ${response.status}`);
    }

    const text = await readOpenAiResponseText(response, payload.returns.length);
    const parsed = JSON.parse(extractJsonArray(text));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

async function readOpenAiResponseText(response, expectedCount) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/event-stream") && response.body) {
    return readOpenAiStream(response.body, expectedCount);
  }

  const data = await response.json();
  return extractChatCompletionText(data);
}

async function readOpenAiStream(stream, expectedCount) {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  let content = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      pending += decoder.decode(value, { stream: true });
      const parsed = consumeSseBuffer(pending);
      pending = parsed.rest;

      for (const data of parsed.events) {
        if (!data || data === "[DONE]") {
          continue;
        }

        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        content += extractStreamDeltaText(chunk);

        if (hasCompleteJsonArray(content, expectedCount)) {
          await reader.cancel();
          return content;
        }
      }
    }

    pending += decoder.decode();
    const tail = consumeSseBuffer(`${pending}\n\n`);
    for (const data of tail.events) {
      if (!data || data === "[DONE]") {
        continue;
      }
      try {
        content += extractStreamDeltaText(JSON.parse(data));
      } catch {
        continue;
      }
    }
    return content || "[]";
  } finally {
    reader.releaseLock();
  }
}

function consumeSseBuffer(buffer) {
  const events = [];
  let rest = buffer;

  while (true) {
    const match = rest.match(/\r?\n\r?\n/);
    if (!match || match.index == null) {
      break;
    }

    const boundary = match.index;
    const rawEvent = rest.slice(0, boundary);
    rest = rest.slice(boundary + match[0].length);

    const lines = rawEvent.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length > 0) {
      events.push(dataLines.join("\n"));
    }
  }

  return { events, rest };
}

function extractStreamDeltaText(chunk) {
  const parts = [];
  for (const choice of chunk?.choices || []) {
    const delta = choice?.delta || {};
    if (typeof delta.content === "string") {
      parts.push(delta.content);
    }
    if (Array.isArray(delta.content)) {
      for (const item of delta.content) {
        if (typeof item?.text === "string") {
          parts.push(item.text);
        }
      }
    }
  }
  return parts.join("");
}

function extractChatCompletionText(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice?.message || {};
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((item) => (typeof item?.text === "string" ? item.text : ""))
      .join("");
  }
  return "[]";
}

function hasCompleteJsonArray(text, expectedCount) {
  const raw = extractJsonArray(text);
  if (raw === "[]") {
    return expectedCount === 0;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length >= expectedCount;
  } catch {
    return false;
  }
}

function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) {
    return "[]";
  }
  return text.slice(start, end + 1);
}

function buildChatCompletionsUrl(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) {
    return "";
  }

  if (raw.endsWith("/chat/completions")) {
    return raw;
  }

  if (raw.endsWith("/v1")) {
    return `${raw}/chat/completions`;
  }

  if (raw.endsWith("/")) {
    return `${raw}chat/completions`;
  }

  return `${raw}/chat/completions`;
}

function buildLocalNamePlan({ functionName, item, index, total }) {
  if (item.isError) {
    return { item, name: "err", confidence: "high", source: "error" };
  }

  if (item.name) {
    return {
      item,
      name: toCamelName(item.name),
      confidence: "high",
      source: "named-return"
    };
  }

  const alias = aliasFromType(item.type);
  if (alias) {
    return { item, name: alias, confidence: "high", source: "type-alias" };
  }

  const functionDerived = deriveNameByFunction(functionName, item.type);
  if (functionDerived.name) {
    return {
      item,
      name: functionDerived.name,
      confidence: functionDerived.confidence,
      source: "function"
    };
  }

  const typeDerived = deriveNameByType(item.type, index, total);
  if (typeDerived.name) {
    return {
      item,
      name: typeDerived.name,
      confidence: typeDerived.confidence,
      source: "type"
    };
  }

  return {
    item,
    name: heuristicName(functionName, item.type, index, total),
    confidence: "low",
    source: "fallback"
  };
}

function shouldAskAiForLocalName(plan) {
  return !plan.item.isError && plan.confidence === "low";
}

function heuristicName(functionName, type, index, total) {
  const simplifiedType = normalizeType(type);
  if (total === 1 || index === 0) {
    const fromFunc = deriveNameByFunction(functionName, type);
    if (fromFunc.name) {
      if (simplifiedType === "bool") {
        return `is${capitalize(fromFunc.name)}`;
      }
      return fromFunc.name;
    }
  }

  switch (simplifiedType) {
    case "string":
      return total === 1 ? "str" : `str${index + 1}`;
    case "bool":
      return total === 1 ? "ok" : `ok${index + 1}`;
    case "int":
    case "int64":
    case "int32":
    case "uint":
    case "uint64":
    case "uint32":
      return total === 1 ? "n" : `n${index + 1}`;
    case "[]byte":
      return total === 1 ? "data" : `data${index + 1}`;
    default:
      if (simplifiedType.startsWith("[]")) {
        return total === 1 ? "items" : `items${index + 1}`;
      }
      if (simplifiedType.startsWith("map[")) {
        return total === 1 ? "m" : `m${index + 1}`;
      }
      if (simplifiedType.startsWith("*")) {
        const ptr = toCamelName(simplifiedType.slice(1));
        return ptr || `result${index + 1}`;
      }
      const base = toCamelName(simplifiedType);
      return base || `result${index + 1}`;
  }
}

function deriveNameByFunction(functionName, type) {
  const rule = matchFunctionRule(functionName);
  if (!rule || !rule.subjectWords.length) {
    return { name: "", confidence: "low" };
  }

  const normalizedType = normalizeType(type);
  if (rule.mode === "count" && isCountLikeType(normalizedType)) {
    return {
      name: rule.fixedName || "count",
      confidence: rule.confidence
    };
  }

  if (rule.mode === "bool" && normalizedType === "bool") {
    return {
      name: buildBooleanName(rule),
      confidence: rule.confidence
    };
  }

  let name = wordsToCamel(rule.subjectWords);
  const isCollection = isCollectionType(normalizedType);

  if (rule.mode === "plural" || isCollection) {
    name = pluralizeCamel(name);
  } else if (rule.mode === "single") {
    name = singularizeCamel(name);
  }

  if (!name) {
    return { name: "", confidence: "low" };
  }

  return {
    name,
    confidence: rule.confidence
  };
}

function deriveNameByType(type, index, total) {
  const normalizedType = normalizeType(type);
  const exactAlias = aliasFromType(normalizedType);
  if (exactAlias) {
    return { name: exactAlias, confidence: "high" };
  }

  if (normalizedType.startsWith("[]")) {
    const elementName = extractTypeBaseName(normalizedType.slice(2));
    if (elementName) {
      return { name: pluralizeCamel(elementName), confidence: "medium" };
    }
    return { name: total === 1 ? "items" : `items${index + 1}`, confidence: "low" };
  }

  if (normalizedType.startsWith("map[")) {
    const mapValueType = extractMapValueType(normalizedType);
    const base = extractTypeBaseName(mapValueType);
    if (base) {
      return { name: `${singularizeCamel(base)}Map`, confidence: "medium" };
    }
    return { name: total === 1 ? "m" : `m${index + 1}`, confidence: "low" };
  }

  const base = extractTypeBaseName(normalizedType);
  if (base) {
    return { name: singularizeCamel(base), confidence: "medium" };
  }

  return { name: "", confidence: "low" };
}

function matchFunctionRule(functionName) {
  const rules = [
    { prefix: "GetAll", mode: "plural", confidence: "high" },
    { prefix: "LoadAll", mode: "plural", confidence: "high" },
    { prefix: "FetchAll", mode: "plural", confidence: "high" },
    { prefix: "Count", mode: "count", confidence: "high", fixedName: "count" },
    { prefix: "Total", mode: "count", confidence: "high", fixedName: "total" },
    { prefix: "Num", mode: "count", confidence: "medium", fixedName: "num" },
    { prefix: "List", mode: "plural", confidence: "high" },
    { prefix: "Query", mode: "plural", confidence: "medium" },
    { prefix: "Search", mode: "plural", confidence: "medium" },
    { prefix: "Get", mode: "single", confidence: "high" },
    { prefix: "Load", mode: "single", confidence: "high" },
    { prefix: "Fetch", mode: "single", confidence: "high" },
    { prefix: "Find", mode: "single", confidence: "high" },
    { prefix: "Create", mode: "single", confidence: "high" },
    { prefix: "Build", mode: "single", confidence: "high" },
    { prefix: "Parse", mode: "single", confidence: "high" },
    { prefix: "Read", mode: "single", confidence: "high" },
    { prefix: "New", mode: "single", confidence: "high" },
    { prefix: "Make", mode: "single", confidence: "medium" },
    { prefix: "Exists", mode: "bool", confidence: "high", boolStyle: "suffix-exists" },
    { prefix: "Exist", mode: "bool", confidence: "medium", boolStyle: "suffix-exists" },
    { prefix: "Has", mode: "bool", confidence: "high", boolStyle: "prefix" },
    { prefix: "Can", mode: "bool", confidence: "high", boolStyle: "prefix" },
    { prefix: "Should", mode: "bool", confidence: "medium", boolStyle: "prefix" },
    { prefix: "Is", mode: "bool", confidence: "high", boolStyle: "prefix" }
  ];

  for (const rule of rules) {
    if (functionName.startsWith(rule.prefix) && functionName.length > rule.prefix.length) {
      const rawSubject = functionName.slice(rule.prefix.length);
      const subjectWords = trimQualifierWords(splitIdentifierWords(rawSubject));
      if (subjectWords.length > 0) {
        return {
          mode: rule.mode,
          confidence: rule.confidence,
          subjectWords,
          prefix: rule.prefix,
          boolStyle: rule.boolStyle || "",
          fixedName: rule.fixedName || ""
        };
      }
    }
  }

  return null;
}

function aliasFromType(type) {
  const normalizedType = normalizeType(type);
  const aliases = {
    "context.Context": "ctx",
    "*http.Request": "req",
    "http.Request": "req",
    "*http.Response": "resp",
    "http.Response": "resp",
    "*http.Client": "client",
    "*sql.DB": "db",
    "*sql.Tx": "tx",
    "*gorm.DB": "db",
    "io.Reader": "reader",
    "io.Writer": "writer",
    "[]byte": "data",
    "[]rune": "runes",
    "*bytes.Buffer": "buf",
    "bytes.Buffer": "buf"
  };
  return aliases[normalizedType] || "";
}

function normalizeType(type) {
  return String(type || "").replace(/\s+/g, " ").trim();
}

function isCountLikeType(type) {
  return /^(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|uintptr)$/i.test(
    normalizeType(type)
  );
}

function splitIdentifierWords(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((part) => part.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/g) || []);
}

function trimQualifierWords(words) {
  const qualifiers = new Set(["By", "With", "From", "For", "In", "On", "At", "Of", "Using"]);
  const result = [];
  for (const word of words) {
    if (qualifiers.has(word)) {
      break;
    }
    result.push(word);
  }
  return result;
}

function wordsToCamel(words) {
  if (!Array.isArray(words) || words.length === 0) {
    return "";
  }
  const normalized = words.map((word) => sanitizeWord(word)).filter(Boolean);
  if (normalized.length === 0) {
    return "";
  }
  const [first, ...rest] = normalized;
  return first.charAt(0).toLowerCase() + first.slice(1) + rest.map(capitalize).join("");
}

function sanitizeWord(word) {
  return String(word || "").replace(/[^A-Za-z0-9]/g, "");
}

function isCollectionType(type) {
  const normalizedType = normalizeType(type);
  return normalizedType.startsWith("[]") || normalizedType.startsWith("map[");
}

function extractMapValueType(type) {
  const normalizedType = normalizeType(type);
  if (!normalizedType.startsWith("map[")) {
    return "";
  }

  let depth = 0;
  for (let i = 0; i < normalizedType.length; i += 1) {
    const ch = normalizedType[i];
    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return normalizedType.slice(i + 1).trim();
      }
    }
  }
  return "";
}

function extractTypeBaseName(type) {
  let normalizedType = normalizeType(type);
  while (normalizedType.startsWith("*")) {
    normalizedType = normalizedType.slice(1).trim();
  }

  if (normalizedType.startsWith("[]")) {
    return extractTypeBaseName(normalizedType.slice(2));
  }

  if (normalizedType.startsWith("map[")) {
    return extractTypeBaseName(extractMapValueType(normalizedType));
  }

  normalizedType = normalizedType.replace(/\[[^\]]*\]/g, "");
  const parts = normalizedType.split(".");
  return toCamelName(parts[parts.length - 1] || "");
}

function pluralizeCamel(name) {
  const words = splitIdentifierWords(name);
  if (words.length === 0) {
    return name;
  }
  words[words.length - 1] = pluralizeWord(words[words.length - 1]);
  return wordsToCamel(words);
}

function singularizeCamel(name) {
  const words = splitIdentifierWords(name);
  if (words.length === 0) {
    return name;
  }
  words[words.length - 1] = singularizeWord(words[words.length - 1]);
  return wordsToCamel(words);
}

function pluralizeWord(word) {
  const raw = String(word || "");
  const lower = raw.toLowerCase();
  if (!raw) {
    return "";
  }
  if (/(s|x|z|ch|sh)$/.test(lower)) {
    return `${raw}es`;
  }
  if (/[^aeiou]y$/.test(lower)) {
    return `${raw.slice(0, -1)}ies`;
  }
  if (lower.endsWith("s")) {
    return raw;
  }
  return `${raw}s`;
}

function singularizeWord(word) {
  const raw = String(word || "");
  const lower = raw.toLowerCase();
  if (!raw) {
    return "";
  }
  if (/[^aeiou]ies$/.test(lower)) {
    return `${raw.slice(0, -3)}y`;
  }
  if (/(ches|shes|ses|xes|zes)$/.test(lower)) {
    return raw.slice(0, -2);
  }
  if (lower.endsWith("s") && !lower.endsWith("ss")) {
    return raw.slice(0, -1);
  }
  return raw;
}

function buildBooleanName(rule) {
  const subjectWords = trimQualifierWords(rule.subjectWords || []);
  if (subjectWords.length === 0) {
    return "ok";
  }

  if (rule.boolStyle === "suffix-exists") {
    const subject = singularizeCamel(wordsToCamel(subjectWords));
    return subject ? `${subject}Exists` : "exists";
  }

  const prefixWord = String(rule.prefix || "").toLowerCase();
  return wordsToCamel([prefixWord, ...subjectWords]) || "ok";
}

function toCamelName(value) {
  if (!value) {
    return "";
  }
  const parts = String(value)
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "";
  }
  const [first, ...rest] = parts;
  return first.charAt(0).toLowerCase() + first.slice(1) + rest.map(capitalize).join("");
}

function capitalize(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function makeUniqueName(candidate, used) {
  let base = sanitizeIdentifier(candidate) || "result";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}${i}`)) {
    i += 1;
  }
  const unique = `${base}${i}`;
  used.add(unique);
  return unique;
}

function sanitizeIdentifier(name) {
  const cleaned = String(name || "")
    .replace(/^[^A-Za-z_]+/, "")
    .replace(/[^A-Za-z0-9_]/g, "");
  if (!cleaned) {
    return "";
  }

  const lowered = cleaned.toLowerCase();
  const safeAlias = reservedIdentifierAlias(lowered);
  if (safeAlias) {
    return safeAlias;
  }

  if (isGoReservedIdentifier(lowered)) {
    return `${cleaned}Value`;
  }
  return cleaned;
}

function reservedIdentifierAlias(name) {
  const aliases = {
    string: "str",
    bool: "ok",
    error: "err",
    byte: "b",
    rune: "r",
    int: "n",
    int8: "n8",
    int16: "n16",
    int32: "n32",
    int64: "n64",
    uint: "u",
    uint8: "u8",
    uint16: "u16",
    uint32: "u32",
    uint64: "u64",
    uintptr: "ptr",
    float32: "f32",
    float64: "f64",
    complex64: "c64",
    complex128: "c128",
    any: "value",
    comparable: "value",
    true: "ok",
    false: "ok",
    iota: "idx",
    nil: "value",
    len: "length",
    cap: "capacity",
    make: "value",
    new: "value",
    append: "items",
    copy: "copied",
    close: "closed",
    delete: "deleted",
    clear: "cleared",
    complex: "complexValue",
    real: "realPart",
    imag: "imagPart",
    panic: "panicValue",
    recover: "recovered",
    min: "minValue",
    max: "maxValue",
    print: "printed",
    println: "printed"
  };
  return aliases[name] || "";
}

function isGoReservedIdentifier(name) {
  return GO_RESERVED_IDENTIFIERS.has(String(name || "").toLowerCase());
}

const GO_RESERVED_IDENTIFIERS = new Set([
  "break",
  "default",
  "func",
  "interface",
  "select",
  "case",
  "defer",
  "go",
  "map",
  "struct",
  "chan",
  "else",
  "goto",
  "package",
  "switch",
  "const",
  "fallthrough",
  "if",
  "range",
  "type",
  "continue",
  "for",
  "import",
  "return",
  "var",
  "bool",
  "byte",
  "complex64",
  "complex128",
  "error",
  "float32",
  "float64",
  "int",
  "int8",
  "int16",
  "int32",
  "int64",
  "rune",
  "string",
  "uint",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "uintptr",
  "true",
  "false",
  "iota",
  "nil",
  "append",
  "cap",
  "close",
  "complex",
  "copy",
  "delete",
  "imag",
  "len",
  "make",
  "new",
  "panic",
  "print",
  "println",
  "real",
  "recover",
  "clear",
  "max",
  "min",
  "any",
  "comparable"
]);

function isErrorType(type) {
  return normalizeType(type) === "error";
}

function flattenReturns(items) {
  const result = [];
  for (const item of items) {
    if (Array.isArray(item)) {
      result.push(...item);
    } else {
      result.push(item);
    }
  }
  return result;
}

function splitTopLevel(text, delimiter) {
  const parts = [];
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let current = "";

  for (const ch of text) {
    if (ch === "(") {
      depthParen += 1;
    } else if (ch === ")") {
      depthParen -= 1;
    } else if (ch === "[") {
      depthBracket += 1;
    } else if (ch === "]") {
      depthBracket -= 1;
    } else if (ch === "{") {
      depthBrace += 1;
    } else if (ch === "}") {
      depthBrace -= 1;
    }

    if (
      ch === delimiter &&
      depthParen === 0 &&
      depthBracket === 0 &&
      depthBrace === 0
    ) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

function skipSpaces(text, index) {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) {
    i += 1;
  }
  return i;
}

function findMatchingParen(text, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < text.length; i += 1) {
    if (text[i] === "(") {
      depth += 1;
    } else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

module.exports = {
  activate,
  deactivate
};
