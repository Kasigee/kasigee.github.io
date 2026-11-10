// Running page: the EAP "try it on a run" upload and the waitlist form. Both post to the EAP
// service named in the section's data-eap-api attribute.
const section = document.querySelector('[data-eap-api]');

if (section) {
  const api = section.dataset.eapApi.replace(/\/$/, '');

  const problem = async (res) => {
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') return body.detail;
    } catch { /* not JSON */ }
    return `Something went wrong (error ${res.status}). Please try again.`;
  };
  const offline = "Couldn't reach the EAP server. Please try again in a minute.";

  const send = async (form, url, init, done) => {
    const status = form.querySelector('.eap-status');
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(await problem(res));
      await done(await res.json());
    } catch (error) {
      status.textContent = error instanceof TypeError ? offline : error.message;
    } finally {
      button.disabled = false;
    }
  };

  const tryForm = section.querySelector('#eap-try');
  tryForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = tryForm.querySelector('.eap-status');
    const result = tryForm.querySelector('.eap-result');
    const file = tryForm.elements.file.files[0];
    if (!file) {
      status.textContent = 'Choose a FIT file first.';
      return;
    }
    const data = new FormData(tryForm);
    data.set('acclimatized', tryForm.elements.acclimatized.checked ? 'true' : 'false');
    result.hidden = true;
    status.textContent = 'Working it out, including the weather for your run…';
    send(tryForm, `${api}/analyze`, { method: 'POST', body: data }, (r) => {
      result.textContent = r.summary;
      result.hidden = false;
      status.textContent = r.sport && !/run/i.test(r.sport) ? `Note: this file is a ${r.sport} activity, and EAP is built for running.` : '';
    });
  });

  const listForm = section.querySelector('#eap-waitlist');
  listForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = listForm.querySelector('.eap-status');
    if (!listForm.elements.email.checkValidity() || !listForm.elements.email.value) {
      status.textContent = 'Please enter your email address.';
      return;
    }
    const body = { ...Object.fromEntries(new FormData(listForm)), source: 'running-page' };
    status.textContent = 'Adding you…';
    send(listForm, `${api}/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, () => {
      listForm.reset();
      status.textContent = "You're on the list. I'll email you when there's a place.";
    });
  });
}
