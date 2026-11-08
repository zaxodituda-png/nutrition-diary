'use strict';
importScripts('vendor/fit-parser.js?v=1','fit-model.js?v=1');
onmessage=async event=>{
  try{const parsed=await FitDecoder.decode(event.data);postMessage({training:FitModel.normalize(parsed)})}
  catch{postMessage({error:'Не удалось прочитать файл тренировки. Проверьте целостность файла, тип велотренировки и пределы: 10 МБ, 100 000 измерений, одна сессия до 7 суток.'})}
};
