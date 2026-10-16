const { checkResource } = require('./card-resource-package.cjs');
const cards = [
  ['math-mean','数学','平均数','practice','平均数小练习','求 $2,4,6$ 的平均数。只填写数值。','4','总和 $12$ 除以 $3$。','MATH.STAT.MEAN',['4']],
  ['math-diff','数学','基础微分','practice','幂函数求导','求 $f(x)=x^3$ 的导数，并说明所用规则。','$f\u2032(x)=3x^2$','使用幂函数求导法则。','MATH.CALC.DIFF.BASIC'],
  ['math-chain','数学','链式法则','practice','分清内外层','求 $y=(2x+1)^2$ 的导数，写出内外层。','$y\u2032=4(2x+1)$','外层是平方函数，内层是 $2x+1$，内层导数为 $2$。','MATH.CALC.DIFF.CHAIN_RULE'],
  ['math-mean-note','数学','平均数','knowledge','平均数怎么理解','平均数表示把总量平均分配。\n\n$$\\bar{x}=\\frac{x_1+x_2+\\cdots+x_n}{n}$$\n\n例如 $3,5,7$ 的平均数为 $5$。','','','MATH.STAT.MEAN'],
  ['math-chain-note','数学','链式法则','knowledge','求导的两层结构','先辨认内外层。\n\n$$\\frac{d}{dx}f(g(x))=f\u2032(g(x))g\u2032(x)$$\n\n外层求导后，别忘记乘以内层导数。','','','MATH.CALC.DIFF.CHAIN_RULE'],
  ['math-blank','数学','','blank','数学思考记录','## 我的问题\n\n________________________\n\n## 已知条件\n\n________________________\n\n## 我的步骤与检查\n\n________________________','','',''],
  ['english-choice','英语','主谓一致','practice','Choose the verb','Choose the correct word: She ___ to school every day.\n\nA. go\nB. goes\n\nWrite A or B.','B','She is third-person singular; use goes.','ENGLISH.GRAMMAR.SUBJECT_VERB',['B','b']],
  ['english-past','英语','一般过去时','practice','Yesterday\u2019s visit','Complete with the past tense of visit:\n\nYesterday, we ___ the museum.\n\nWrite only the missing word.','visited','Regular past tense: visit + ed.','ENGLISH.GRAMMAR.PAST_SIMPLE',['visited']],
  ['english-writing','英语','句子表达','practice','An object that matters','Write 3\u20134 sentences about an object you use every day. Explain what it is and why it matters.','Open response.','Rubric: identifies an object; explains its use and significance; sentences are understandable. Do not invent spelling mistakes or require a particular opinion.','ENGLISH.WRITING.SENTENCES'],
  ['english-note','英语','一般过去时','knowledge','Past tense reminders','Use the past tense for completed past actions.\n\n| Present | Past |\n| --- | --- |\n| visit | visited |\n| play | played |\n| go | went |\n\nYesterday, I visited a museum.','','','ENGLISH.GRAMMAR.PAST_SIMPLE'],
  ['english-word-note','英语','词汇搭配','knowledge','Learn words in context','## Take a photo\n\nI **take a photo** of the garden.\n\nTry keeping a word together with a useful phrase, not just its translation.','','','ENGLISH.VOCAB.COLLOCATIONS'],
  ['english-blank','英语','','blank','My word notebook','## Word / phrase\n\n________________________\n\n## Meaning in my own words\n\n________________________\n\n## A sentence I created\n\n________________________','','',''],
];
function builtinResources(){return cards.map(([cardId,subject,knowledgePoint,purpose,title,prompt,answer,explanation,knowledgePointId,acceptedAnswers])=>checkResource({
  publisherId:'edu-builtin',publisherName:'教育管家原创示例',cardId,version:1,scope:'builtin',purpose,type:'structured',status:'published',template:'clear',
  languagePolicy:{instructionLanguage:subject==='英语'?'en':'zh-CN'},licenseNote:'教育管家原创教学示例；允许用户用于学习与教学。',
  content:{title,subject,knowledgePoint,knowledgePointId,minutes:10,prompt,answer,explanation,hint:purpose==='practice'?(subject==='英语'?'Read the question carefully, then work step by step.':'先确定题目要求，再逐步作答。'):'',
    ...(acceptedAnswers?{assessment:{kind:'exact',acceptedAnswers}}:{})},publishedAt:'2026-10-09T00:00:00.000Z'
}));}
module.exports={builtinResources};
