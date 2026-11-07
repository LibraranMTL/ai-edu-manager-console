'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const tools = [
  { name: 'query_current_student_education', description: '查询当前 Windows 学生终端所绑定学生的教育档案和关联项目知识。只返回主机授权范围内带来源的结果。', inputSchema: { type: 'object', properties: { question: { type: 'string', maxLength: 2000 } }, required: ['question'], additionalProperties: false } },
  { name: 'get_current_student_learning_trajectory', description: '读取当前学生知识点证据、复习优先级和建议复习时间，不把状态表述为已经掌握或遗忘。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

async function run(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!/^http:\/\/127\.0\.0\.1:\d+\/invoke$/.test(String(config.endpoint || ''))) throw Error('LOCAL_ENDPOINT_REQUIRED');
  const invoke = async body => {
    const token = fs.readFileSync(config.credentialFile, 'utf8').trim();
    const response = await fetch(config.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return response.json();
  };
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let message;
    try {
      message = JSON.parse(line);
      if (message.id === undefined) continue;
      let result;
      if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'ai-education-student', version: '1.0.0' }, instructions: '只查询当前个人终端绑定学生。保留 edu:// 来源；依据不足时明确说明。' };
      else if (message.method === 'ping') result = {};
      else if (message.method === 'tools/list') result = { tools };
      else if (message.method === 'tools/call') {
        const name = message.params?.name, args = message.params?.arguments || {};
        if (!tools.some(tool => tool.name === name)) throw Error('UNKNOWN_TOOL');
        const value = await invoke(name === 'query_current_student_education' ? { action: 'query', question: args.question } : { action: 'trajectory' });
        result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: value.ok === false };
      } else throw Error('METHOD_NOT_FOUND');
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: String(error.code || error.message || 'REQUEST_FAILED') } })}\n`);
    }
  }
}

if (require.main === module) run(process.argv[2]).catch(() => { process.stderr.write('学生端教育资料连接不可用。\n'); process.exitCode = 1; });
module.exports = { tools, run };
