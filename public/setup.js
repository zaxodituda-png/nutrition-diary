'use strict';
document.getElementById('setupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const status = document.getElementById('setupStatus');
  try {
    const sessionResponse = await fetch('api/index.php?action=session', {credentials:'same-origin', cache:'no-store'});
    const session = await sessionResponse.json();
    if (!sessionResponse.ok) throw new Error(session.error);
    const response = await fetch('api/index.php?action=setup', {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},
      body:JSON.stringify({token:document.getElementById('setupToken').value,username:document.getElementById('setupUser').value,password:document.getElementById('setupPassword').value})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    event.target.reset();
    status.textContent = 'Администратор создан. Отключите setup_token_hash в конфигурации и войдите в дневник.';
  } catch (error) { status.textContent = error.message || 'Не удалось завершить настройку.'; }
  finally { button.disabled = false; }
});
