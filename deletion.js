(function (root) {
  'use strict';

  const deletionCodePattern =
    /^spdel1:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f]{64})$/;
  const deletionEndpoint =
    'https://ufjzgusccbigwrdfcpan.supabase.co/rest/v1/rpc/delete_profile';
  const publishableKey =
    'sb_publishable_WSzZ3XFuqteeg2Ms9Q9XEw_p1BL5DnA';

  function parseDeletionCode(value) {
    if (typeof value !== 'string') return null;
    const match = deletionCodePattern.exec(value.trim());
    if (!match) return null;
    return { playerId: match[1], deletionProof: match[2] };
  }

  function buildDeletionRequest(value) {
    const parsed = parseDeletionCode(value);
    if (!parsed) return null;
    return {
      p_player_id: parsed.playerId,
      p_player_secret: `delete:${parsed.deletionProof}`,
    };
  }

  function deletionFormState({ code, confirmed, busy, cooldown }) {
    const valid = parseDeletionCode(code) !== null;
    return {
      valid,
      canSubmit:
        valid && confirmed === true && busy !== true && cooldown !== true,
    };
  }

  function retryAfterSeconds(value) {
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return 30;
    const seconds = Number(value.trim());
    if (!Number.isSafeInteger(seconds)) return 30;
    return Math.max(30, seconds);
  }

  function deletionRequestConfig(value) {
    const body = buildDeletionRequest(value);
    if (!body) return null;
    return {
      url: deletionEndpoint,
      options: {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      },
    };
  }

  function exactSuccess(value) {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      value.ok === true
    );
  }

  async function submitDeletion(value, fetchImplementation) {
    const config = deletionRequestConfig(value);
    if (!config) return { status: 'invalid' };
    const request = fetchImplementation || root.fetch;
    if (typeof request !== 'function') return { status: 'network' };

    const controller = typeof root.AbortController === 'function'
      ? new root.AbortController()
      : null;
    const timeout = controller
      ? root.setTimeout(() => controller.abort(), 15000)
      : null;
    try {
      const response = await request(config.url, {
        ...config.options,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (response.status === 429) {
        return {
          status: 'rate-limited',
          retryAfterSeconds: retryAfterSeconds(
            response.headers.get('retry-after'),
          ),
        };
      }
      if (!response.ok) return { status: 'rejected' };
      const cacheControl = response.headers.get('cache-control') || '';
      if (!cacheControl.toLowerCase().split(',').map((part) => part.trim()).includes('no-store')) {
        return { status: 'result' };
      }
      const value = await response.json();
      return { status: exactSuccess(value) ? 'success' : 'result' };
    } catch (_) {
      return { status: 'network' };
    } finally {
      if (timeout !== null) root.clearTimeout(timeout);
    }
  }

  function bindDeletionForm(form) {
    const code = form.querySelector('[data-deletion-code]');
    const confirm = form.querySelector('[data-deletion-confirm]');
    const submit = form.querySelector('[data-deletion-submit]');
    const status = form.querySelector('[data-deletion-status]');
    const cooldown = form.querySelector('[data-deletion-cooldown]');
    if (!code || !confirm || !submit || !status || !cooldown) return;

    let busy = false;
    let cooldownUntil = 0;
    let cooldownTimer = null;
    const setStatus = (message, kind) => {
      status.textContent = message;
      status.dataset.kind = kind;
    };
    const remainingCooldown = () =>
      Math.max(0, Math.ceil((cooldownUntil - root.Date.now()) / 1000));
    const update = () => {
      const state = deletionFormState({
        code: code.value,
        confirmed: confirm.checked,
        busy,
        cooldown: remainingCooldown() > 0,
      });
      submit.disabled = !state.canSubmit;
      submit.textContent = busy
        ? form.dataset.deletionBusy
        : form.dataset.deletionSubmit;
      form.setAttribute('aria-busy', String(busy));
      code.setAttribute('aria-invalid', String(code.value.length > 0 && !state.valid));
      return state;
    };
    const renderCooldown = () => {
      const seconds = remainingCooldown();
      cooldown.textContent = seconds > 0
        ? form.dataset.deletionCooldown.replace('{seconds}', String(seconds))
        : '';
      if (seconds === 0 && cooldownTimer !== null) {
        root.clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
      update();
    };
    const startCooldown = (seconds) => {
      cooldownUntil = Math.max(
        cooldownUntil,
        root.Date.now() + retryAfterSeconds(String(seconds)) * 1000,
      );
      if (cooldownTimer === null) {
        cooldownTimer = root.setInterval(renderCooldown, 250);
      }
      renderCooldown();
    };

    code.addEventListener('input', () => {
      if (status.dataset.kind !== 'success') setStatus('', '');
      update();
    });
    code.addEventListener('blur', () => {
      const state = update();
      if (code.value.length > 0 && !state.valid) {
        setStatus(form.dataset.deletionInvalid, 'error');
      }
    });
    confirm.addEventListener('change', update);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !update().canSubmit) {
        setStatus(form.dataset.deletionInvalid, 'error');
        return;
      }
      busy = true;
      setStatus(form.dataset.deletionProgress, 'progress');
      startCooldown(30);
      const result = await submitDeletion(code.value);
      busy = false;
      if (result.status === 'rate-limited') {
        startCooldown(result.retryAfterSeconds);
        setStatus(form.dataset.deletionRateLimited, 'error');
      } else if (result.status === 'success') {
        form.reset();
        setStatus(form.dataset.deletionSuccess, 'success');
      } else if (result.status === 'rejected') {
        setStatus(form.dataset.deletionRejected, 'error');
      } else if (result.status === 'result') {
        setStatus(form.dataset.deletionResult, 'error');
      } else {
        setStatus(form.dataset.deletionNetwork, 'error');
      }
      update();
    });
    update();
  }

  function initialize() {
    for (const form of root.document.querySelectorAll('[data-deletion-form]')) {
      bindDeletionForm(form);
    }
  }

  const api = {
    buildDeletionRequest,
    deletionFormState,
    deletionRequestConfig,
    parseDeletionCode,
    retryAfterSeconds,
    submitDeletion,
  };
  root.SanapolkuDeletion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
      initialize();
    }
  }
})(typeof globalThis === 'undefined' ? this : globalThis);
