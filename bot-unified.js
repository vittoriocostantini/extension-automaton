(() => {
  const LS_BOT_RUN_PHASE = 'will_bot_run_phase';
  const LS_STEP_LIFELINE = 'will_bot_step_lifeline_done';

  const SELECTORS = {
    account: {
      start: 'button[ng-click="c.createAccount()"]',
      firstName: '#firstName',
      lastName: '#lastName',
      dobMonth: '#dobMonth',
      dobDay: '#dobDay',
      dobYear: '#dobYear',
      ssnType: '#idType_ssn',
      ssnText: '#ssnText',
      street: '#streetNumberName',
      apt: '#apt',
      city: '#city',
      state: '#state',
      zipcode: '#zipcode',
      nextAddress: '#consumerNextSuccessButton',
      username: '#username',
      password: '#password',
      password2: '#password2',
      email: '#email',
      notifications: '#radioButton-both',
      terms: '#applicantTermsConditionsCheckbox',
      captchaSubmit: '#consumerNextButton'
    },
    lifeline: {
      start: "button[ng-click*=\"startNewApplication('lifeline')\"]",
      nextReady: '#eligMedicaid, .section-header'
    },
    medicaid: {
      checkbox: '#eligMedicaid',
      next: '#govProgramNextSuccessButton'
    },
    review: {
      checkbox: '#applicantInfoCheckbox',
      nextSuccess: '#nextSuccessButton9',
      nextError: '#nextErrorButton7',
      nextFallback: '.indi-button--primary'
    },
    final: {
      signature: 'input[name="applicantSignature"]',
      signatureCheckbox: 'input[name="applicantSignatureCheckbox"]',
      signatureInitials: 'input[id^="initial"]',
      reviewCheckbox: '#applicantInfoCheckbox',
      nextSignature: '#nextErrorButton6, #nextSuccessButton7, .indi-button--primary'
    },
    accountMenu: '#MyAccount_btn, .dropdown-toggle'
  };

  let userActionResolver = null;

  function debugLog(hypothesisId, location, message, data) {
    if (typeof window.debugLog === 'function') {
      window.debugLog(hypothesisId, location, message, data);
    }
  }

  function triggerEvents(el) {
    if (!el) return;
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setCheckboxChecked(checkbox) {
    if (!checkbox) return false;

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
    if (nativeSetter) nativeSetter.call(checkbox, true);
    else checkbox.checked = true;

    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    checkbox.dispatchEvent(new Event('blur', { bubbles: true }));
    return Boolean(checkbox.checked);
  }

  function normalizeKey(key) {
    return String(key || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function getField(data, aliases) {
    if (!data || typeof data !== 'object') return '';
    const normalizedMap = new Map();
    Object.keys(data).forEach((k) => normalizedMap.set(normalizeKey(k), data[k]));
    for (const alias of aliases) {
      const direct = data[alias];
      if (direct !== undefined && direct !== null && String(direct).trim() !== '') return direct;
      const found = normalizedMap.get(normalizeKey(alias));
      if (found !== undefined && found !== null && String(found).trim() !== '') return found;
    }
    return '';
  }

  function normalizeDobValue(raw) {
    if (raw === null || raw === undefined) return null;
    const str = String(raw).trim();
    if (!str) return null;

    const asNum = Number(str);
    if (!Number.isNaN(asNum) && Number.isFinite(asNum) && asNum > 1000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(excelEpoch.getTime() + Math.floor(asNum) * 24 * 60 * 60 * 1000);
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      const yyyy = String(date.getUTCFullYear());
      return `${mm}/${dd}/${yyyy}`;
    }

    const ymd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (ymd) return `${ymd[2].padStart(2, '0')}/${ymd[3].padStart(2, '0')}/${ymd[1]}`;

    const mdy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (mdy) {
      const year = mdy[3].length === 2 ? `19${mdy[3]}` : mdy[3];
      return `${mdy[1].padStart(2, '0')}/${mdy[2].padStart(2, '0')}/${year}`;
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let settled = false;
      let observer;
      let fallbackId;

      const cleanup = () => {
        if (observer) observer.disconnect();
        if (fallbackId !== undefined) clearInterval(fallbackId);
      };

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(arg);
      };

      const check = () => {
        const el = document.querySelector(selector);
        if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
          finish(resolve, el);
          return true;
        }
        if (Date.now() - startTime > timeout) {
          finish(reject, new Error(`Timeout esperando: ${selector}`));
          return true;
        }
        return false;
      };

      if (check()) return;

      observer = new MutationObserver(() => {
        check();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'disabled', 'hidden', 'aria-hidden', 'ng-disabled']
      });

      fallbackId = setInterval(() => check(), 300);
    });
  }

  function waitControl(msg) {
    chrome.runtime.sendMessage({ action: 'WAIT_USER', message: msg }).catch(() => {});
    return new Promise((resolve) => {
      userActionResolver = resolve;
    });
  }

  function cancelPendingWaitControl() {
    userActionResolver = null;
  }

  function clearAllRegistrationStepState() {
    localStorage.removeItem(LS_STEP_LIFELINE);
    localStorage.removeItem(LS_BOT_RUN_PHASE);
    sessionStorage.removeItem(LS_STEP_LIFELINE);
  }

  function setStepLifelineDone() {
    localStorage.setItem(LS_STEP_LIFELINE, 'true');
  }

  function normalizeFinalResult(rawResult) {
    if (rawResult && rawResult.__botResult) return rawResult;
    if (rawResult && typeof rawResult === 'string') {
      if (rawResult === 'TIMEOUT') return { __botResult: true, outcome: 'timeout', qualificationId: null };
      if (/^[A-Z]\d{5,}-\d+$/.test(rawResult)) {
        return { __botResult: true, outcome: 'success', qualificationId: rawResult };
      }
      return { __botResult: true, outcome: rawResult.toLowerCase(), qualificationId: null };
    }
    return { __botResult: true, outcome: 'unknown', qualificationId: null };
  }

  async function handleErrorScreen(isSilentLogout = false) {
    try {
      const btnAccount = document.querySelector(SELECTORS.accountMenu);
      if (btnAccount) {
        btnAccount.click();
        await sleep(1500);
        const linkSignOut = Array.from(document.querySelectorAll('a')).find((el) => {
          const clickExpr = el.getAttribute('ng-click') || '';
          return clickExpr.includes('signOut') || (el.innerText || '').includes('Sign Out');
        });
        if (linkSignOut) {
          linkSignOut.click();
          await sleep(2000);
        }
      }
    } catch (err) {
      if (!isSilentLogout) console.warn('No se pudo cerrar sesion automaticamente.', err);
    }
    return isSilentLogout ? null : 'NEED_MORE_INFO';
  }

  async function handleReviewStep() {
    try {
      const cb = document.querySelector(SELECTORS.review.checkbox);
      if (cb && !cb.checked) {
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await sleep(500);
      const btnS = document.querySelector(SELECTORS.review.nextSuccess);
      const btnE = document.querySelector(SELECTORS.review.nextError);
      if (btnS && btnS.offsetHeight > 0) btnS.click();
      else if (btnE && btnE.offsetHeight > 0) btnE.click();
      else document.querySelector(SELECTORS.review.nextFallback)?.click();
      await sleep(10000);
      return 'next';
    } catch (e) {
      const retryAction = await waitControl('Error en Review. ¿Reintentar este paso?');
      return retryAction === 'retry' ? 'retry' : 'next';
    }
  }

  async function extractIdUniversal() {
    const text = document.body.textContent || '';
    const match = text.match(/[A-Z]\d{5,}-\d+/);
    return match ? match[0] : null;
  }

  async function fillSignatureManual(data) {
    const fName = (data['First Name'] || '').trim();
    const lName = (data['Last Name(s)'] || '').trim();
    const initials = (fName[0] + (lName[0] || '')).toLowerCase();
    document.querySelectorAll(SELECTORS.final.signatureInitials).forEach((input) => {
      input.value = initials;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sigInput = document.querySelector(SELECTORS.final.signature);
    if (sigInput) {
      sigInput.value = `${fName} ${lName}`.trim();
      sigInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const cb = document.querySelector(SELECTORS.final.signatureCheckbox);
    if (cb && !cb.checked) {
      cb.scrollIntoView({ block: 'center' });
      cb.dispatchEvent(new Event('focus', { bubbles: true }));

      const label =
        cb.closest('label') ||
        (cb.id ? document.querySelector(`label[for="${cb.id}"]`) : null);

      // En este formulario Angular, hacer click en el label activa estados touched/dirty.
      if (label) label.click();
      cb.click();

      if (!cb.checked) setCheckboxChecked(cb);
      await sleep(150);
      if (!cb.checked) setCheckboxChecked(cb);
    }
  }

  async function handleDuplicateCase() {
    const qualificationId = await extractIdUniversal();
    try {
      await handleErrorScreen(true);
    } catch (err) {
      console.warn('No se pudo cerrar sesion en caso duplicado.', err);
    }
    return { __botResult: true, outcome: 'duplicate', qualificationId: qualificationId || null };
  }

  async function handleFinalSteps(data) {
    const detectScreen = () => {
      if (document.querySelector(SELECTORS.final.signature)) return 'FIRMA';
      if (document.querySelector(SELECTORS.final.reviewCheckbox)) return 'REVIEW';
      const text = document.body.textContent || '';
      if (/Our Records Show That You Already Have Lifeline|Decide if you want to/i.test(text)) return 'DUPLICADO';
      if (/You Qualify|approved/i.test(text)) return 'EXITO';
      if (text.includes('We need more information')) return 'ERROR_INFO';
      return null;
    };

    let result = detectScreen();
    if (!result) {
      await new Promise((resolve) => {
        const deadline = Date.now() + 35000;
        let timeoutId;
        let pollId;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          observer.disconnect();
          if (pollId !== undefined) clearInterval(pollId);
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          resolve();
        };
        const observer = new MutationObserver(() => {
          result = detectScreen();
          if (result) done();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        pollId = setInterval(() => {
          result = detectScreen();
          if (result || Date.now() > deadline) done();
        }, 400);
        timeoutId = setTimeout(done, 35000);
      });
    }

    result = result || 'TIMEOUT';
    if (result === 'EXITO') {
      const id = await extractIdUniversal();
      await handleErrorScreen(true);
      return id;
    }
    if (result === 'DUPLICADO') return handleDuplicateCase();
    if (result === 'FIRMA') {
      await fillSignatureManual(data);
      document.querySelector(SELECTORS.final.nextSignature)?.click();
      await sleep(10000);
      return handleFinalSteps(data);
    }
    if (result === 'REVIEW') {
      await handleReviewStep();
      return handleFinalSteps(data);
    }
    return result;
  }

  async function handleLifeline() {
    const sel = SELECTORS.lifeline.start;
    try {
      const btn = await waitForElement(sel, 20000);
      btn.removeAttribute('disabled');
      btn.removeAttribute('ng-disabled');
      btn.classList.remove('disabled');
      btn.style.pointerEvents = 'auto';
      btn.style.visibility = 'visible';
      btn.style.display = 'block';
      btn.scrollIntoView({ block: 'center' });
      await sleep(1000);

      try {
        const script = document.createElement('script');
        script.textContent =
          "(function(){const el=document.querySelector(\"button[ng-click*='lifeline']\");if(!el)return;const ng=window.angular&&window.angular.element?window.angular.element(el):null;const scope=ng&&ng.scope?ng.scope():null;if(scope&&scope.c&&scope.c.startNewApplication){scope.$apply(()=>scope.c.startNewApplication('lifeline'));}else{el.click();}})();";
        document.documentElement.appendChild(script);
        script.remove();
      } catch (_) {}

      const rect = btn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const cfg = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      btn.dispatchEvent(new MouseEvent('mousedown', cfg));
      btn.dispatchEvent(new MouseEvent('mouseup', cfg));
      btn.dispatchEvent(new MouseEvent('click', cfg));

      await waitForElement(SELECTORS.lifeline.nextReady, 12000);
      setStepLifelineDone();
      return 'next';
    } catch (e) {
      debugLog('U1', 'bot-unified.js', 'Lifeline fallo', { error: e.message });
      const action = await waitControl('No pude entrar a Lifeline. Haz clic manual y pulsa CONTINUAR.');
      return action === 'retry' ? 'retry' : 'next';
    }
  }

  async function handleMedicaid() {
    try {
      await waitForElement(SELECTORS.medicaid.checkbox, 15000);
      const checkbox = document.querySelector(SELECTORS.medicaid.checkbox);
      if (checkbox && !checkbox.checked) checkbox.click();
      await sleep(2000);
      document.querySelector(SELECTORS.medicaid.next)?.click();
      return 'next';
    } catch (e) {
      console.warn('Paso Medicaid con error, continuo.', e.message);
      return 'next';
    }
  }

  async function handleAccountPart1(data) {
    try {
      const btn = await waitForElement(SELECTORS.account.start, 30000);
      btn.click();
      await waitForElement(SELECTORS.account.firstName, 15000);
    } catch (e) {
      if ((await waitControl('No detecte el formulario de registro.')) === 'retry') return 'retry';
    }

    const firstNameValue = getField(data, ['First Name', 'FIRST NAME', 'firstname', 'first_name']);
    const lastNameValue = getField(data, ['Last Name(s)', 'LAST NAME(S)', 'last name', 'lastname', 'last_name']);
    const fName = document.querySelector(SELECTORS.account.firstName);
    const lName = document.querySelector(SELECTORS.account.lastName);
    if (fName) {
      fName.value = String(firstNameValue || '').trim();
      triggerEvents(fName);
    }
    if (lName) {
      lName.value = String(lastNameValue || '').trim();
      triggerEvents(lName);
    }

    const dobRaw = getField(data, ['date of birth', 'Date of Birth', 'DOB', 'dob', 'birth date', 'fecha de nacimiento']);
    const dobNormalized = normalizeDobValue(dobRaw);
    const dobParts = String(dobNormalized || '').split('/');
    if (dobParts.length === 3) {
      const m = document.querySelector(SELECTORS.account.dobMonth);
      const d = document.querySelector(SELECTORS.account.dobDay);
      const y = document.querySelector(SELECTORS.account.dobYear);
      if (m) {
        m.value = dobParts[0].padStart(2, '0');
        triggerEvents(m);
      }
      if (d) {
        d.value = dobParts[1].padStart(2, '0');
        triggerEvents(d);
      }
      if (y) {
        y.value = dobParts[2];
        triggerEvents(y);
      }
    }

    const ssnValue = getField(data, ['SSN', 'ssn', 'social', 'social security number']);
    if (ssnValue) {
      document.querySelector(SELECTORS.account.ssnType)?.click();
      const ssnInput = document.querySelector(SELECTORS.account.ssnText);
      if (ssnInput) {
        ssnInput.value = String(ssnValue).replace(/-/g, '').trim().slice(-4);
        triggerEvents(ssnInput);
      }
    }

    const aptValueRaw = getField(data, [
      'Apt',
      'APT',
      'Apartment',
      'Apartment Number',
      'Apartment or Unit',
      'Unit',
      'Address 2',
      'address2',
      'applicantUnit'
    ]);

    const map = [
      [SELECTORS.account.street, getField(data, ['Street Number and Name', 'street', 'address', 'Address 1', 'Street Address'])],
      [SELECTORS.account.apt, '__apt__'],
      [SELECTORS.account.city, getField(data, ['City', 'city'])],
      [SELECTORS.account.state, getField(data, ['State', 'state'])],
      [SELECTORS.account.zipcode, getField(data, ['Zip Code', 'ZIP CODE', 'Zip', 'zipcode', 'postal code'])]
    ];
    map.forEach(([selector, value]) => {
      const el = document.querySelector(selector);
      if (!el) return;
      const source = value === '__apt__' ? aptValueRaw : value;
      const val = String(source || '').trim();
      el.value = selector === SELECTORS.account.state ? val.toUpperCase() : val;
      triggerEvents(el);
    });

    await sleep(2000);
    document.querySelector(SELECTORS.account.nextAddress)?.click();

    try {
      await waitForElement(SELECTORS.account.username, 10000);
      const user = document.querySelector(SELECTORS.account.username);
      const pass1 = document.querySelector(SELECTORS.account.password);
      const pass2 = document.querySelector(SELECTORS.account.password2);
      const email = document.querySelector(SELECTORS.account.email);
      if (user) {
        user.value = String(getField(data, ['Username', 'username', 'user']) || '').trim();
        triggerEvents(user);
      }
      if (pass1) {
        pass1.value = String(getField(data, ['Password', 'password', 'pass']) || '').trim();
        triggerEvents(pass1);
      }
      if (pass2) {
        pass2.value = String(getField(data, ['Password', 'password', 'pass']) || '').trim();
        triggerEvents(pass2);
      }
      if (email) {
        email.value = String(getField(data, ['email address', 'Email Address', 'email', 'e-mail']) || '').trim();
        triggerEvents(email);
      }
      document.querySelector(SELECTORS.account.notifications)?.click();
      document.querySelector(SELECTORS.account.terms)?.click();
      await sleep(500);
      [user, pass1, pass2, email].forEach(triggerEvents);
    } catch (e) {
      console.warn('No se completaron credenciales automaticamente.', e.message);
    }

    const action = await waitControl('Resuelve el primer CAPTCHA y pulsa CONTINUAR.');
    if (action === 'retry') return 'retry';
    const btnSuccess = document.querySelector(SELECTORS.account.captchaSubmit);
    if (btnSuccess && btnSuccess.offsetParent !== null) btnSuccess.click();
    return 'next';
  }

  async function runPart1(data) {
    if (window.bot_running) return;
    window.bot_running = true;
    localStorage.setItem('bot_active', 'true');
    localStorage.setItem('bot_current_data', JSON.stringify(data || {}));
    localStorage.setItem(LS_BOT_RUN_PHASE, 'part1');
    try {
      const res = await handleAccountPart1(data || {});
      if (res !== 'next') return;
      localStorage.setItem('bot_active', 'false');
      localStorage.removeItem(LS_BOT_RUN_PHASE);
    } catch (err) {
      console.error('Parte 1 fallo:', err);
      localStorage.setItem('bot_active', 'false');
      localStorage.removeItem('bot_current_data');
      clearAllRegistrationStepState();
    } finally {
      window.bot_running = false;
    }
  }

  async function runPart2(data) {
    if (window.bot_running) return;
    window.bot_running = true;
    localStorage.setItem('bot_active', 'true');
    localStorage.setItem('bot_current_data', JSON.stringify(data || {}));
    localStorage.setItem(LS_BOT_RUN_PHASE, 'part2');
    try {
      const life = await handleLifeline();
      if (life === 'retry') return;
      const medicaid = await handleMedicaid();
      if (medicaid === 'retry') return;
      const finalRaw = await handleFinalSteps(data || {});
      const finalResult = normalizeFinalResult(finalRaw);
      console.log('Resultado final:', finalResult);
      localStorage.setItem('bot_active', 'false');
      localStorage.removeItem('bot_current_data');
      clearAllRegistrationStepState();
    } catch (err) {
      console.error('Parte 2 fallo:', err);
      localStorage.setItem('bot_active', 'false');
      localStorage.removeItem('bot_current_data');
      clearAllRegistrationStepState();
    } finally {
      window.bot_running = false;
    }
  }

  function inferPhaseForResume() {
    const explicit = localStorage.getItem(LS_BOT_RUN_PHASE);
    if (explicit === 'part1' || explicit === 'part2') return explicit;
    return localStorage.getItem(LS_STEP_LIFELINE) === 'true' ? 'part2' : 'part1';
  }

  async function resumeIfNeeded() {
    if (window.bot_running) return;
    if (localStorage.getItem('bot_active') !== 'true') return;
    const raw = localStorage.getItem('bot_current_data');
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const phase = inferPhaseForResume();
    if (phase === 'part2') runPart2(data);
    else runPart1(data);
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'USER_CLICKED' && userActionResolver) {
      const resolveFunc = userActionResolver;
      userActionResolver = null;
      resolveFunc(request.choice);
    }
    return true;
  });

  window.WillBotUnified = {
    SELECTORS,
    runPart1,
    runPart2,
    resumeIfNeeded,
    cancelPendingWaitControl,
    clearAllRegistrationStepState
  };
})();
