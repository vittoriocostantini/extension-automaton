(() => {
  const LS_BOT_RUN_PHASE = 'will_bot_run_phase';

  function runPhase(action, payload) {
    if (!window.WillBotUnified) return;
    if (action === 'STOP_BOT') {
      window.WillBotUnified.requestStop(payload?.reason || 'launcher-stop');
      return;
    }

    window.bot_running = false;
    window.WillBotUnified.cancelPendingWaitControl();

    if (action === 'START_BOT_PART1') {
      localStorage.setItem(LS_BOT_RUN_PHASE, 'part1');
      window.WillBotUnified.clearAllRegistrationStepState();
      window.WillBotUnified.runPart1(payload || {});
      return;
    }

    if (action === 'START_BOT_PART2') {
      localStorage.setItem(LS_BOT_RUN_PHASE, 'part2');
      window.WillBotUnified.runPart2(payload || {});
    }
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (
      request.action === 'START_BOT_PART1' ||
      request.action === 'START_BOT_PART2' ||
      request.action === 'STOP_BOT'
    ) {
      runPhase(request.action, request.payload);
    }
    return true;
  });

  function startWatcher() {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      window.WillBotUnified?.resumeIfNeeded();
    };
    window.addEventListener('pageshow', () => queueMicrotask(check));
    window.addEventListener('focus', () => setTimeout(check, 150));
    setInterval(check, 3000);
    check();
  }

  startWatcher();
})();
