async (page) => {
  const installInPage = () => {
    const STORAGE_KEY = 'wodwiki.flightLog.v1';

    const safeParseJson = (raw, fallback) => {
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    };

    const readAgentViewState = () => {
      const el = document.getElementById('agent-view-state');
      const parsed = safeParseJson(el ? el.textContent : null, null);
      if (!parsed) {
        return {
          route: {
            pathname: window.location.pathname,
            search: window.location.search,
            hash: window.location.hash,
          },
          status: document.querySelector('main')?.getAttribute('data-agent-status') ?? null,
          feedReadiness: document.documentElement.getAttribute('data-feed-state') ?? null,
          stream: null,
          explorer: null,
          editor: null,
          clock: null,
        };
      }
      return {
        route: parsed.route ?? {
          pathname: window.location.pathname,
          search: window.location.search,
          hash: window.location.hash,
        },
        status: parsed.status ?? null,
        feedReadiness: parsed.feedReadiness ?? null,
        stream: parsed.stream
          ? {
              route: parsed.stream.route ?? null,
              query: parsed.stream.query ?? null,
              layout: parsed.stream.layout ?? null,
              totalUnbatchedCount: parsed.stream.totalUnbatchedCount ?? null,
            }
          : null,
        explorer: parsed.explorer
          ? {
              submitted: parsed.explorer.submitted ?? null,
              weeks: parsed.explorer.weeks ?? null,
            }
          : null,
        editor: parsed.editor
          ? {
              noteId: parsed.editor.noteId ?? null,
              readonly: Boolean(parsed.editor.readonly),
              workoutBlockIds: Array.isArray(parsed.editor.workoutBlockIds)
                ? parsed.editor.workoutBlockIds
                : [],
            }
          : null,
        clock: parsed.clock ?? null,
      };
    };

    const readSessionLog = () => {
      try {
        return safeParseJson(window.sessionStorage.getItem(STORAGE_KEY), []);
      } catch {
        return [];
      }
    };

    if (!Array.isArray(window.__wodFlightLog)) {
      window.__wodFlightLog = readSessionLog();
    }

    const persistLog = () => {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(window.__wodFlightLog));
      } catch {
        // Ignore storage quota errors during long sessions.
      }
    };

    const pushEvent = (entry) => {
      const record = {
        seq: window.__wodFlightLog.length + 1,
        ts: Date.now(),
        route: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        viewState: readAgentViewState(),
        ...entry,
      };
      window.__wodFlightLog.push(record);
      persistLog();
      return record;
    };

    const cleanText = (text, maxLen = 90) => {
      if (!text) return '';
      const compact = String(text).replace(/\s+/g, ' ').trim();
      return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
    };

    const describeTarget = (node) => {
      const el = node instanceof Element ? node : null;
      if (!el) return null;
      const testIdHost = el.closest('[data-testid]');
      const interactive =
        el.closest(
          'button, a, input, textarea, select, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="combobox"]',
        ) || testIdHost || el;

      const ariaLabel = interactive.getAttribute('aria-label');
      const labelledBy = interactive.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
        : '';
      const id = interactive.getAttribute('id');
      const explicitLabel = id
        ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? ''
        : interactive.closest('label')?.textContent ?? '';
      const placeholder = interactive.getAttribute('placeholder') ?? '';
      const label = cleanText(
        ariaLabel || labelledText || explicitLabel || placeholder || interactive.textContent || '',
      );

      return {
        testId: testIdHost ? testIdHost.getAttribute('data-testid') : null,
        tag: interactive.tagName.toLowerCase(),
        role: interactive.getAttribute('role') || null,
        label: label || null,
        href: interactive instanceof HTMLAnchorElement ? interactive.getAttribute('href') : null,
        inputType: interactive instanceof HTMLInputElement ? interactive.type : null,
      };
    };

    if (window.__wodFlightRecorderInstalled) {
      return {
        installed: true,
        existingEvents: window.__wodFlightLog.length,
      };
    }
    window.__wodFlightRecorderInstalled = true;

    let lastRecordedRoute =
      window.__wodFlightLog.length > 0
        ? window.__wodFlightLog[window.__wodFlightLog.length - 1].route
        : null;

    const recordRouteIfChanged = (trigger) => {
      if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
        return;
      }
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (current === lastRecordedRoute) return;
      lastRecordedRoute = current;
      pushEvent({
        kind: 'navigate',
        actor: 'system',
        trigger,
        path: current,
      });
    };

    recordRouteIfChanged('initial');

    let pendingEditorTimer = null;
    let lastEditorSnapshot = null;

    const flushEditorDraft = (actor = 'human') => {
      if (pendingEditorTimer) {
        clearTimeout(pendingEditorTimer);
        pendingEditorTimer = null;
      }
      const cmContent = document.querySelector('.cm-editor .cm-content');
      if (!cmContent) return;
      const lines = Array.from(cmContent.querySelectorAll('.cm-line')).map(
        (line) => line.textContent ?? '',
      );
      const docText = lines.join('\n');
      const vs = readAgentViewState();
      const noteKey = `${vs.editor?.noteId ?? window.location.pathname}::${docText}`;
      if (noteKey === lastEditorSnapshot) return;
      lastEditorSnapshot = noteKey;
      pushEvent({
        kind: 'editor',
        actor,
        noteId: vs.editor?.noteId ?? null,
        content: docText,
      });
    };

    document.addEventListener(
      'click',
      (event) => {
        const targetEl = event.target instanceof Element ? event.target : null;
        if (!targetEl) return;
        const inCodeMirrorText =
          Boolean(targetEl.closest('.cm-content')) &&
          !targetEl.closest('button, a, [data-testid], [role="button"]');
        if (inCodeMirrorText) return;

        const target = describeTarget(targetEl);
        if (!target) return;
        pushEvent({
          kind: 'click',
          actor: event.isTrusted ? 'human' : 'agent',
          target,
        });
      },
      true,
    );

    document.addEventListener(
      'change',
      (event) => {
        const el = event.target;
        if (
          !(
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLSelectElement
          )
        ) {
          return;
        }
        if (el.closest('.cm-editor')) return;
        const target = describeTarget(el);
        const value =
          el instanceof HTMLInputElement && el.type === 'password'
            ? '[REDACTED]'
            : el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
              ? String(el.checked)
              : el.value;
        pushEvent({
          kind: 'fill',
          actor: event.isTrusted ? 'human' : 'agent',
          target,
          value,
        });
      },
      true,
    );

    document.addEventListener(
      'input',
      (event) => {
        const targetEl = event.target instanceof Element ? event.target : null;
        if (!targetEl || !targetEl.closest('.cm-editor')) return;
        const actor = event.isTrusted ? 'human' : 'agent';
        if (pendingEditorTimer) clearTimeout(pendingEditorTimer);
        pendingEditorTimer = setTimeout(() => flushEditorDraft(actor), 600);
      },
      true,
    );

    document.addEventListener(
      'keydown',
      (event) => {
        const isPaletteShortcut = (event.ctrlKey || event.metaKey) && event.key === '/';
        const isEscape = event.key === 'Escape';
        const isSearchEnter =
          event.key === 'Enter' &&
          event.target instanceof Element &&
          !event.target.closest('.cm-editor');
        if (!isPaletteShortcut && !isEscape && !isSearchEnter) return;
        const combo = isPaletteShortcut
          ? 'ControlOrMeta+/'
          : event.key;
        pushEvent({
          kind: 'shortcut',
          actor: event.isTrusted ? 'human' : 'agent',
          key: combo,
          target: describeTarget(event.target),
        });
      },
      true,
    );

    window.addEventListener('popstate', () => {
      flushEditorDraft();
      recordRouteIfChanged('popstate');
    });

    window.addEventListener('pagehide', () => {
      flushEditorDraft();
      persistLog();
    });

    const observeAgentViewState = () => {
      const attachObserver = () => {
        const scriptEl = document.getElementById('agent-view-state');
        if (!scriptEl) return false;
        const obs = new MutationObserver(() => {
          recordRouteIfChanged('router');
        });
        obs.observe(scriptEl, { childList: true, characterData: true, subtree: true });
        return true;
      };
      if (!attachObserver()) {
        const bodyObs = new MutationObserver(() => {
          if (attachObserver()) bodyObs.disconnect();
        });
        bodyObs.observe(document.documentElement, { childList: true, subtree: true });
      }
    };
    observeAgentViewState();

    const wrapModelContext = (holder) => {
      if (!holder || !holder.modelContext || holder.modelContext.__wodWrapped) return;
      const mc = holder.modelContext;
      if (typeof mc.executeTool !== 'function') return;
      const orig = mc.executeTool.bind(mc);
      mc.executeTool = async (...args) => {
        let toolName = 'unknown';
        let toolArgs = {};
        if (typeof args[0] === 'string') {
          toolName = args[0];
          toolArgs = args[1] ?? {};
        } else if (args[0] && typeof args[0] === 'object') {
          toolName = args[0].name ?? 'unknown';
          toolArgs = 'arguments' in args[0] ? args[0].arguments : (args[1] ?? {});
        }
        const res = await orig(...args);
        recordRouteIfChanged('webmcp');
        pushEvent({
          kind: 'webmcp',
          actor: 'webmcp',
          toolName,
          toolArgs,
        });
        return res;
      };
      mc.__wodWrapped = true;
    };

    wrapModelContext(navigator);
    wrapModelContext(document);
    setTimeout(() => {
      wrapModelContext(navigator);
      wrapModelContext(document);
    }, 1000);

    window.__wodRecordNote = (text, noteKind = 'expect') => {
      flushEditorDraft();
      return pushEvent({
        kind: noteKind === 'step' ? 'step-note' : 'expect',
        actor: 'collab',
        text: String(text),
      });
    };

    window.__wodExportFlightLog = () => {
      flushEditorDraft();
      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        origin: window.location.origin,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        finalViewState: readAgentViewState(),
        events: window.__wodFlightLog,
      };
    };

    window.__wodClearFlightLog = () => {
      window.__wodFlightLog = [];
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore on opaque origins such as about:blank.
      }
      return true;
    };

    return {
      installed: true,
      existingEvents: window.__wodFlightLog.length,
    };
  };

  await page.context().addInitScript(installInPage);
  return await page.evaluate(installInPage);
}
