import React from 'react';
import { createRoot } from 'react-dom/client';
import { PracticeCardsPanel } from '../../src/PracticeCardsPanel';
import '../../src/styles.css';
const call = async (method: string, args: unknown[]) => (await fetch('/__practice_test', { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,args}) })).text();
const api = {
  practiceAction:(id:string,action:string,input:unknown)=>call('action',[id,action,input]),
  generatePracticeCard:(id:string)=>call('generate',[id]), savePracticePlan:(id:string,input:unknown)=>call('savePlan',[id,input]),
  startPracticeCard:(id:string,cardId:string)=>call('start',[id,cardId]), submitPracticeAttempt:(id:string,cardId:string,input:unknown)=>call('submit',[id,cardId,input]),
};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1280,margin:'28px auto',padding:16}}><p>隔离测试环境 · 虚构学生 · 不连接真实 Agent</p><PracticeCardsPanel studentId="fixture-student" api={api} /></main>);
