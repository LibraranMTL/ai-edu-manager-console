'use strict';

const crypto = require('node:crypto');

function stableOffsetMinutes(studentId, taskKind, periodKey, windowMinutes = 120) {
  const digest = crypto.createHash('sha256').update(`${studentId}|${taskKind}|${periodKey}`).digest();
  return digest.readUInt32BE(0) % Math.max(1, Number(windowMinutes) || 120);
}

function staggeredScheduleTime(studentId, taskKind, periodKey, preferred = '21:30') {
  const match = String(preferred || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return String(preferred || '');
  const hour = Number(match[1]);
  if (hour !== 8 && hour !== 21) return `${String(hour).padStart(2, '0')}:${match[2]}`;
  const total = hour * 60 + stableOffsetMinutes(studentId, taskKind, periodKey);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

module.exports = { stableOffsetMinutes, staggeredScheduleTime };
