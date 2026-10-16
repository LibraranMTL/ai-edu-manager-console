'use strict';
// Bounded subset used by the host's fixed JSON contracts (never executable schema).
function check(value, schema, depth = 0) {
  if (depth > 32) throw Error('结构化结果嵌套过深');
  if (!schema || typeof schema !== 'object') throw Error('结果合同无效');
  if (schema.enum && !schema.enum.includes(value) || Object.hasOwn(schema, 'const') && schema.const !== value) throw Error('结构化结果枚举不符');
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('结果应为对象');
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw Error(`结果缺少字段 ${key}`);
    for (const key of Object.keys(value)) {
      if (schema.properties?.[key]) check(value[key], schema.properties[key], depth + 1);
      else if (schema.additionalProperties === false) throw Error(`结果含未声明字段 ${key}`);
    }
  } else if (type === 'array') {
    if (!Array.isArray(value) || value.length > 10000 || schema.minItems && value.length < schema.minItems || schema.maxItems && value.length > schema.maxItems) throw Error('结果数组不符');
    for (const item of value) check(item, schema.items, depth + 1);
  } else if (type === 'integer' ? !Number.isInteger(value) : type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : type && typeof value !== type) throw Error('结果字段类型不符');
  return value;
}
module.exports = { check };
