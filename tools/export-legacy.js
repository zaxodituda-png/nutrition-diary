// Run in DevTools Console ON THE OLD SITE in the SAME browser/profile used for the diary.
// Reads only; never clears localStorage or sends records over the network.
(()=>{
  const raw=localStorage.getItem('nutrition-diary-v1');
  if(raw===null)throw new Error('No saved localStorage entries on this origin/profile. Check the old URL and browser.');
  const entries=JSON.parse(raw);
  if(!entries||typeof entries!=='object'||Array.isArray(entries))throw new Error('Unexpected diary format. Keep the raw data for recovery.');
  const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='nutrition-diary-legacy.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
})();
