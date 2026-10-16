import React from 'react';
export type Audience = {type:string;studentIds:string[];grade:string};
export const currentAudience = (id:string):Audience => ({type:'students',studentIds:id?[id]:[],grade:''});
export function PublicationAudience({value,onChange,students}:{value:Audience;onChange:(value:Audience)=>void;students:Array<{id:string;name:string;grade?:string}>}) {
  return <fieldset className="publication-audience"><legend>谁可以使用</legend><label>学生范围<select value={value.type} onChange={e=>onChange({...value,type:e.target.value})}><option value="students">指定学生</option><option value="grade">指定年级</option><option value="all">全部本机学生</option></select></label>
    {value.type==='grade'?<label>年级<select value={value.grade} onChange={e=>onChange({...value,grade:e.target.value})}><option value="">请选择</option>{[...new Set(students.map(s=>s.grade).filter(Boolean))].map(g=><option key={g}>{g}</option>)}</select></label>:null}
    {value.type==='students'?<div className="publication-students">{students.map(s=><label key={s.id}><input type="checkbox" checked={value.studentIds.includes(s.id)} onChange={e=>onChange({...value,studentIds:e.target.checked?[...value.studentIds,s.id]:value.studentIds.filter(id=>id!==s.id)})}/>{s.name}<small>{s.grade||'未设置年级'}</small></label>)}</div>:null}
    <small>发布后，已配对学生刷新即可看到。开始使用时才建立个人学习记录。</small>
  </fieldset>;
}
