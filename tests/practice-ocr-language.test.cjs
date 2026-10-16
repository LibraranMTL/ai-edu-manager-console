const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
test('real Windows OCR uses installed language fallback without network or modifying source',{skip:process.platform!=='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'practice-ocr-language-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const {createCanvas}=require('@napi-rs/canvas'),canvas=createCanvas(800,200),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,800,200);ctx.fillStyle='black';ctx.font='48px Arial';ctx.fillText('Hello 123',30,100);
 const file=path.join(root,'sample.png'),bytes=canvas.toBuffer('image/png');await fs.writeFile(file,bytes);
 const result=await require('../electron/project-material-extract.cjs').runImageOcr({path:file},{language:'en'});
 assert(result.text.trim());assert(result.language);if(result.languageFallback)assert(result.warnings.some(w=>w.includes('未安装所选 OCR 语言')));assert.deepEqual(await fs.readFile(file),bytes);
});
