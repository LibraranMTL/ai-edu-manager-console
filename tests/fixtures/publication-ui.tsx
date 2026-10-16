import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PracticeResourcesPanel} from '../../src/PracticeResourcesPanel';
import {PublicationManager} from '../../src/PublicationManager';
import {StudentPublishedCards} from '../../src/StudentPublishedCards';
import '../../src/styles.css';
import '../../src/practice-cards.css';
async function call(mode:string,id:string,name:string,input:any={}){const r=await(await fetch('/__publication_test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode,id,name,input})})).json();if(!r.ok)throw Error(r.message);return r.data;}
function Fixture(){const[id,setId]=useState('test-a'),[mode,setMode]=useState('editor'),[edit,setEdit]=useState<any>(null);return <main style={{maxWidth:1200,margin:'20px auto',padding:16}}><p>隔离验收 · 虚构学生 · 不连接模型或生产数据</p><label>验收角色<select value={mode} onChange={e=>setMode(e.target.value)}><option value="editor">主机卡片编辑</option><option value="manager">主机统一发布</option><option value="student">Windows 学生端</option></select></label><label>验收学生<select value={id} onChange={e=>setId(e.target.value)}><option value="test-a">虚构学生甲</option><option value="test-b">虚构学生乙</option></select></label>{mode==='editor'?<PracticeResourcesPanel initialPublication={edit} onPublicationConsumed={()=>setEdit(null)} key={id} action={(n,i)=>call('editor',id,n,i)} onStarted={()=>setMode('student')}/>:mode==='manager'?<PublicationManager onEdit={item=>{setEdit(item);setMode('editor');}} key={id} studentId={id} action={(_,n,i)=>call('manager',id,n,i)}/>:<StudentPublishedCards key={id} studentId={id} action={(n,i)=>call('student',id,n,i)}/>}</main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
