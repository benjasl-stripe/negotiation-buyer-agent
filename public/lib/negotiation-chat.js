/**
 * Shared chat-style rendering for buyer ↔ seller negotiation threads.
 */
(function (global) {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderInlineMarkdown(s) {
    let out = s;
    out = out.replace(
      /(\$[\d]{1,3}(?:,\d{3})+(?:\.\d{2})?|\$[\d]+(?:\.\d{2})?|\$[\d.,]+[kK]\b)/g,
      '<span class="price-tag">$1</span>'
    );
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    out = out.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    out = out.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
    return out;
  }

  function renderMarkdownToHtml(text) {
    const lines = String(text || '').split(/\r?\n/);
    const parts = [];
    for (const raw of lines) {
      const line = raw.trimEnd();
      const trimmed = line.trim();
      if (!trimmed) {
        parts.push('<br>');
        continue;
      }
      const statusMatch = trimmed.match(/^STATUS:\s*(AGREED|WALKED)\b/i);
      if (statusMatch) {
        const status = statusMatch[1].toUpperCase();
        parts.push(
          '<div class="status-line status-' +
            statusMatch[1].toLowerCase() +
            '"><strong>STATUS: ' +
            escapeHtml(status) +
            '</strong></div>'
        );
        continue;
      }
      parts.push('<div class="md-line">' + renderInlineMarkdown(escapeHtml(line)) + '</div>');
    }
    return parts.join('');
  }

  function applyRichText(el, text) {
    el.classList.add('rich-text');
    el.innerHTML = renderMarkdownToHtml(text);
  }

  function ensureThread(container) {
    let thread = container.querySelector(':scope > .neg-thread');
    if (!thread) {
      thread = document.createElement('div');
      thread.className = 'neg-thread';
      container.appendChild(thread);
    }
    return thread;
  }

  /**
   * @param {HTMLElement} container
   * @param {number} round
   */
  function appendRoundDivider(container, round) {
    const thread = ensureThread(container);
    const div = document.createElement('div');
    div.className = 'neg-round-divider';
    div.textContent = 'Round ' + round;
    thread.appendChild(div);
  }

  /**
   * @param {{
   *   speaker: string,
   *   text?: string,
   *   round?: number,
   *   buyerActivity?: unknown[],
   *   skipActivity?: boolean,
   * }} opts
   */
  function buildMessage(opts) {
    const isBuyer = opts.speaker === 'buyer';
    const msg = document.createElement('div');
    msg.className = 'neg-msg ' + (isBuyer ? 'buyer' : 'seller');

    const avatar = document.createElement('div');
    avatar.className = 'neg-avatar';
    avatar.textContent = isBuyer ? 'B' : 'S';
    avatar.setAttribute('aria-hidden', 'true');

    const col = document.createElement('div');
    col.className = 'neg-msg-col';

    const head = document.createElement('div');
    head.className = 'neg-msg-head';
    const name = document.createElement('span');
    name.className = 'neg-msg-name';
    name.textContent = isBuyer ? 'Buyer agent' : 'Seller agent';
    head.appendChild(name);
    if (typeof opts.round === 'number') {
      const round = document.createElement('span');
      round.className = 'neg-msg-round';
      round.textContent = 'Round ' + opts.round;
      head.appendChild(round);
    }

    const bubble = document.createElement('div');
    bubble.className = 'neg-bubble';
    const body = document.createElement('div');
    body.className = 'neg-bubble-body';
    bubble.appendChild(body);

    col.appendChild(head);
    col.appendChild(bubble);

    const activity = opts.buyerActivity;
    if (isBuyer && !opts.skipActivity && Array.isArray(activity) && activity.length) {
      const details = document.createElement('details');
      details.className = 'neg-tools';
      const summary = document.createElement('summary');
      summary.textContent = 'Internal steps (' + activity.length + ')';
      const toolsBody = document.createElement('div');
      toolsBody.className = 'neg-tools-body';
      toolsBody.textContent = activity
        .map((a) => '· ' + (a && typeof a === 'object' && a.text ? a.text : String(a)))
        .join('\n');
      details.appendChild(summary);
      details.appendChild(toolsBody);
      col.appendChild(details);
    }

    msg.appendChild(avatar);
    msg.appendChild(col);

    return { root: msg, bodyEl: body };
  }

  /**
   * @param {HTMLElement} container
   * @param {{ speaker: string, text?: string, round?: number, buyerActivity?: unknown[], skipActivity?: boolean }} opts
   */
  function appendMessage(container, opts) {
    const thread = ensureThread(container);
    const built = buildMessage(opts);
    thread.appendChild(built.root);
    return built;
  }

  /**
   * @param {HTMLElement} container
   * @param {unknown[]} transcript
   */
  function renderTranscript(container, transcript) {
    container.innerHTML = '';
    const thread = document.createElement('div');
    thread.className = 'neg-thread';
    container.appendChild(thread);

    if (!Array.isArray(transcript) || !transcript.length) {
      container.innerHTML = '<p class="meta">No transcript saved.</p>';
      return;
    }

    let lastRound = null;
    for (const row of transcript) {
      const round = typeof row.round === 'number' ? row.round : null;
      if (round != null && round !== lastRound) {
        if (lastRound != null || round > 1) {
          const div = document.createElement('div');
          div.className = 'neg-round-divider';
          div.textContent = 'Round ' + round;
          thread.appendChild(div);
        }
        lastRound = round;
      }

      const built = buildMessage({
        speaker: row.speaker,
        text: row.text || '',
        round: round ?? undefined,
        buyerActivity: row.buyerActivity ?? row.buyer_activity,
      });
      applyRichText(built.bodyEl, row.text || '');
      thread.appendChild(built.root);
    }
  }

  global.NegotiationChat = {
    escapeHtml,
    applyRichText,
    renderMarkdownToHtml,
    ensureThread,
    appendRoundDivider,
    buildMessage,
    appendMessage,
    renderTranscript,
  };
})(typeof window !== 'undefined' ? window : globalThis);
