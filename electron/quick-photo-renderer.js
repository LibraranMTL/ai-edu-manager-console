'use strict';
const $ = id => document.getElementById(id);
let stream = null, shot = null, shotUrl = '', request = 0, disposed = false, busy = false;
function stopCamera() {
  request++;
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  $('camera').srcObject = null; $('camera').hidden = true;
  $('indicator').textContent = '摄像头已关闭'; $('indicator').classList.remove('active');
  $('take').hidden = true; $('stop').hidden = true; $('device-label').hidden = true;
  $('open').hidden = Boolean(shot); $('placeholder').hidden = Boolean(shot);
}
function clearShot() {
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  shot = null; shotUrl = ''; $('shot').hidden = true; $('shot').removeAttribute('src');
  $('retake').hidden = true; $('save').hidden = true;
  $('retake').textContent = '重拍';
}
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
async function run(work) {
  if (busy) return;
  busy = true; document.querySelectorAll('button,select').forEach(button => { button.disabled = true; });
  try { await work(); } catch (error) { message(error.message || '操作失败，请重试。', true); }
  finally { busy = false; if (!disposed) document.querySelectorAll('button,select').forEach(button => { button.disabled = false; }); }
}
async function openCamera(deviceId) {
  stopCamera(); clearShot();
  const revision = request;
  message('正在打开摄像头…');
  const permission = await window.QuickPhoto.camera();
  if (!permission.ok) throw Error(permission.message);
  let next;
  try { next = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
  catch (error) {
    const messages = { NotAllowedError: '摄像头访问被拒绝，请在 Windows 隐私设置中允许桌面应用使用摄像头后重试。', NotFoundError: '未找到摄像头，请连接设备后重试。', NotReadableError: '摄像头可能被其他应用占用，请关闭占用后重试。', OverconstrainedError: '所选摄像头已不可用，请重新打开。' };
    throw Error(messages[error.name] || `摄像头无法打开：${error.message}`);
  }
  if (disposed || revision !== request) { next.getTracks().forEach(track => track.stop()); return; }
  stream = next;
  try { $('camera').srcObject = next; await $('camera').play(); }
  catch (error) { stopCamera(); throw error; }
  if (disposed || revision !== request) return;
  $('camera').hidden = false; $('placeholder').hidden = true; $('open').hidden = true;
  $('take').hidden = false; $('stop').hidden = false;
  $('indicator').textContent = '● 摄像头已开启 · 仅拍照时保存'; $('indicator').classList.add('active');
  next.getVideoTracks()[0].addEventListener('ended', () => { if (stream === next) { stopCamera(); message('摄像头已断开，请重新连接。', true); } });
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  if (disposed || revision !== request) return;
  $('device').replaceChildren(); devices.filter(d => d.kind === 'videoinput').forEach((d, i) => $('device').add(new Option(d.label || `摄像头 ${i + 1}`, d.deviceId)));
  $('device').value = next.getVideoTracks()[0].getSettings().deviceId || '';
  $('device-label').hidden = $('device').options.length < 2;
  message('调整画面后点击“拍摄”。');
}
$('open').addEventListener('click', () => run(() => openCamera()));
$('device').addEventListener('change', () => run(() => openCamera($('device').value)));
$('retake').addEventListener('click', () => run(() => openCamera()));
$('stop').addEventListener('click', () => { stopCamera(); message('摄像头已关闭。'); });
$('close').addEventListener('click', () => { stopCamera(); window.QuickPhoto.close(); });
$('take').addEventListener('click', () => run(async () => {
  const video = $('camera');
  if (!stream || !video.videoWidth) throw Error('摄像头画面尚未就绪，请稍后重试。');
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob || blob.size > 20 * 1024 * 1024) throw Error('照片生成失败或超过 20 MiB，请重试。');
  if (disposed) return;
  shot = { blob, shotId: crypto.randomUUID() }; shotUrl = URL.createObjectURL(blob);
  stopCamera(); $('shot').src = shotUrl; $('shot').hidden = false;
  $('save').hidden = false; $('retake').hidden = false;
  message('照片尚未保存。可重拍，或确认保存到此学生的收件箱。');
}));
$('save').addEventListener('click', () => run(async () => {
  if (!shot) return;
  message('正在保存照片…');
  const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error('读取照片失败')); reader.readAsDataURL(shot.blob); });
  const result = await window.QuickPhoto.save({ shotId: shot.shotId, base64 });
  if (!result.ok) throw Error(result.message);
  $('save').hidden = true; $('retake').textContent = '继续拍照'; message(result.message);
}));
window.addEventListener('pagehide', () => { disposed = true; stopCamera(); clearShot(); });
window.QuickPhoto.context().then(result => {
  if (!result.ok) throw Error(result.message);
  $('owner').textContent = `资料所属：${result.student.name} · 本次拍照固定保存到该学生收件箱`;
  $('open').disabled = false;
}).catch(error => message(error.message, true));
