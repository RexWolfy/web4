// Web4 developer docs: terminal, code tabs, copy buttons, contents highlighting.
// Like script.js, everything here runs in the browser. Nothing is sent or stored.
// Loaded as build.js?v=N: after changing it, raise N on every page (see styles.css).

(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Copy buttons ---------- */

  // Shell blocks copy only the commands: prompts and output lines are left out
  const textOf = (block) => {
    const pre = block.querySelector('pre:not([hidden])').cloneNode(true);
    if (block.dataset.lang !== 'shell') return pre.textContent;
    pre.querySelectorAll('.p, .o').forEach((el) => el.remove());
    return pre.textContent.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  };

  const writeClipboard = async (text) => {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  };

  document.querySelectorAll('.code').forEach((block) => {
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'copy', textContent: 'Copy' });
    let timer;
    button.addEventListener('click', async () => {
      try {
        await writeClipboard(textOf(block));
        button.textContent = 'Copied';
        button.classList.add('is-done');
      } catch {
        button.textContent = 'Failed';
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('is-done');
      }, 1600);
    });
    block.querySelector('.code__head').append(button);
  });

  /* ---------- Tabs ---------- */

  document.querySelectorAll('[role="tablist"]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const select = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    };

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (event) => {
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select(tabs[(next + tabs.length) % tabs.length], true);
      });
    });

    select(tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0]);
  });

  /* ---------- Contents: highlight the section in view ---------- */

  const toc = document.querySelector('.toc');
  const links = [...toc.querySelectorAll('a[href^="#"]')];
  if (links.length && 'IntersectionObserver' in window) {
    const setActive = (id) => {
      links.forEach((a) => {
        if (a.hash === `#${id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
      // On small screens the contents scroll sideways; keep the active link in view
      const active = links.find((a) => a.hash === `#${id}`);
      if (active && toc.scrollWidth > toc.clientWidth) {
        toc.scrollTo({
          left: active.offsetLeft - (toc.clientWidth - active.offsetWidth) / 2,
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      }
    };

    // A thin band near the top of the viewport: whichever section crosses it is current
    const observer = new IntersectionObserver((entries) => {
      entries.filter((entry) => entry.isIntersecting).forEach((entry) => setActive(entry.target.id));
    }, { rootMargin: '-25% 0px -70% 0px' });

    links.forEach((a) => {
      const section = document.getElementById(a.hash.slice(1));
      if (section) observer.observe(section);
    });
  }

  /* ---------- Feedback ---------- */

  const feedback = document.getElementById('feedback');
  feedback.hidden = false;
  feedback.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      feedback.textContent = 'Thanks. Noted by 1/1 nodes.';
    });
  });

  /* ---------- Terminal ---------- */

  const term = document.getElementById('term');
  const body = document.getElementById('term-body');
  const out = document.getElementById('term-out');
  const form = document.getElementById('term-form');
  const input = document.getElementById('term-input');
  const title = document.getElementById('term-title');
  const tryBar = document.getElementById('term-try');

  const MARKS = { cmd: '$', ok: '✓', err: '✗', run: '→' };
  const MAX_LINES = 200;

  // One output line. Marked kinds get a red symbol in front; others are plain text in a colour.
  const line = (kind, text) => {
    const p = document.createElement('p');
    if (MARKS[kind]) {
      const mark = document.createElement('span');
      mark.className = kind === 'cmd' ? 't-ps' : `t-${kind}`;
      mark.textContent = MARKS[kind];
      p.append(mark, ` ${text}`);
    } else {
      if (kind) p.className = `t-${kind}`;
      p.textContent = text;
    }
    out.append(p);
    while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
    body.scrollTop = body.scrollHeight;
    return p;
  };

  // Output is queued so lines appear one after another, in order, even while typing ahead.
  // `skipping` fast-forwards the intro when someone clicks in before it has finished.
  let queue = Promise.resolve();
  let skipping = false;
  const wait = (ms) => (skipping || reduceMotion || !ms ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

  const print = (lines) => {
    queue = queue.then(async () => {
      for (const [kind, text, delay = 40] of lines) {
        await wait(delay);
        line(kind, text);
      }
    });
    return queue;
  };

  const typeCommand = async (text) => {
    const typed = document.createTextNode('');
    line('cmd', '').append(typed);
    for (const ch of text) {
      await wait(45 + Math.random() * 55);
      typed.data += ch;
    }
  };

  const state = { project: 'my-dapp', mints: 0 };

  const HELP = [
    ['init <name>', 'create a new project'],
    ['node start', 'start your single node blockchain'],
    ['think <n>', 'think of a number and have it'],
    ['mint', 'mint a super turbo mega ultra NFT'],
    ['deploy', 'ship it to mainnet'],
    ['upgrade', 'upgrade to web5'],
    ['status', 'check the status of web4'],
    ['clear', 'clear the terminal'],
  ];

  const preinstalled = () => [['ok', 'already installed. web4 comes preinstalled']];

  // Each command returns lines as [kind, text, delay before the line in ms]
  const COMMANDS = {
    help: () => [
      ['', 'usage: web4 <command>', 0],
      ...HELP.map(([cmd, desc]) => ['dim', `  ${cmd.padEnd(13)} ${desc}`, 25]),
    ],
    version: () => [['', 'web4 4.0.0 (again)', 0]],
    status: () => [['run', 'soon', 0]],

    init: ([name = 'my-dapp']) => {
      state.project = name.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'my-dapp';
      title.textContent = `~/${state.project} — web4`;
      return [
        ['ok', `created ${state.project}/`, 160],
        ['ok', 'installed hypercrypto (0 dependencies)', 220],
        ['ok', 'single node blockchain ready', 220],
        ['dim', 'next: web4 node start', 120],
      ];
    },

    node: ([sub = 'start']) => (sub !== 'start' ? [['err', 'usage: web4 node start']] : [
      ['run', 'starting node 1 of 1...', 80],
      ['ok', 'single node blockchain running on localhost:4444', 450],
      ['ok', 'consensus reached (1/1 nodes agree)', 280],
    ]),

    think: ([n]) => {
      if (n === undefined) return [['err', 'think of a number first. usage: web4 think <n>']];
      const number = n.replace(/[_,]/g, '');
      if (/^-\d/.test(number)) return [['err', 'think positive']];
      if (!/^\d+(\.\d+)?$/.test(number)) return [['err', `W4-422: "${n}" is not a number. think harder`]];
      const pretty = number.replace(/^\d+/, (int) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
      return [
        ['run', 'thinking...', 80],
        ['ok', `balance: ${pretty} HYPER`, 500],
        ['dim', '  confirmed by 1/1 nodes · finality: instant', 60],
      ];
    },

    mint: () => {
      state.mints += 1;
      const id = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      const minted = [['run', 'minting...', 80], ['ok', `minted super turbo mega ultra NFT #${id}`, 420]];
      // Every third one is a little too hot
      return state.mints % 3 === 0
        ? [...minted, ['err', `W4-999: NFT #${id} went up in flames. this is expected`, 900]]
        : [...minted, ['dim', '  level: the next · temperature: very hot', 60]];
    },

    deploy: () => [
      ['run', 'building...', 80],
      ['ok', 'built in 0.004s (4 kB, supercharged)', 500],
      ['run', 'deploying to mainnet...', 160],
      ['ok', 'deployed to 1/1 nodes', 800],
      ['dim', `  live at https://${state.project}.web4 (soon)`, 60],
    ],

    upgrade: () => [
      ['run', 'upgrading to web5...', 80],
      ['err', 'W4-425: too early. web5 was too far ahead', 900],
      ['run', 'restoring from backup...', 300],
      ['ok', 'web4 restored. this time for real', 1000],
    ],

    ls: () => [['', 'contracts/  nfts/  web4.config.js  README.md', 0]],
    cat: ([file = '']) => (file.toLowerCase() === 'readme.md'
      ? [['', `# ${state.project}`, 0], ['', 'built on web4. (soon)', 0]]
      : [['err', `cat: ${file || 'nothing'}: soon`]]),
    cd: () => [],
    echo: (args) => [['', args.join(' '), 0]],
    whoami: () => [['', 'a web4 developer (since just now)', 0]],
    sudo: () => [['err', 'you are already supercharged']],
    rm: () => [['err', 'permission denied: web4 is forever']],
    exit: () => [['err', 'there is no going back to web3']],
    web3: () => [['err', 'web3: command not found. did you mean web4?']],
    web5: () => [['err', 'W4-425: too early']],
    npm: preinstalled,
    yarn: preinstalled,
    pnpm: preinstalled,
    brew: preinstalled,
    pip: preinstalled,
  };

  const ALIASES = { '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version', '--status': 'status', quit: 'exit' };
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  const history = [];
  let historyIndex = 0;

  const execute = (raw) => {
    const text = raw.trim();
    print([['cmd', text, 0]]);
    if (!text) return;

    history.push(text);
    historyIndex = history.length;

    // "web4 mint" and "mint" both work; a bare "web4" shows the help
    let [cmd, ...args] = text.split(/\s+/);
    if (cmd.toLowerCase() === 'web4') [cmd = 'help', ...args] = args;
    cmd = cmd.toLowerCase();
    if (has(ALIASES, cmd)) cmd = ALIASES[cmd];

    if (cmd === 'clear') {
      queue = queue.then(() => out.replaceChildren());
      return;
    }

    print(has(COMMANDS, cmd) ? COMMANDS[cmd](args) : [['err', `command not found: ${cmd}. try 'help'`]]);
  };

  // Tab completes the first word after an optional "web4"
  const NAMES = ['help', 'init', 'node start', 'think', 'mint', 'deploy', 'upgrade', 'status', 'clear', 'version'];
  const complete = (value) => {
    const match = value.match(/^(\s*(?:web4\s+)?)(\S*)$/i);
    if (!match) return null;
    const pool = match[1] ? NAMES : [...NAMES, 'web4'];
    const hits = pool.filter((name) => name.startsWith(match[2].toLowerCase()));
    return hits.length === 1 ? `${match[1]}${hits[0]} ` : null;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    execute(input.value);
    input.value = '';
  });

  input.addEventListener('keydown', (event) => {
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && history.length) {
      event.preventDefault();
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
      input.value = history[historyIndex] || '';
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    } else if (event.key === 'Tab' && input.value.trim()) {
      // Only swallow Tab when there is something to complete, so keyboard users can still tab out
      const completed = complete(input.value);
      if (completed) {
        event.preventDefault();
        input.value = completed;
      }
    } else if (event.key === 'l' && event.ctrlKey) {
      event.preventDefault();
      out.replaceChildren();
    }
  });

  // Intro: type out a first command once the terminal is on screen, then hand over the prompt
  let introDone = false;
  let resolveIntro;
  const ready = new Promise((resolve) => { resolveIntro = resolve; });

  const intro = async () => {
    await wait(400);
    await typeCommand('web4 init my-dapp');
    await wait(250);
    await print(COMMANDS.init(['my-dapp']));
    await print([['com', "# type 'help' to see what web4 can do", 300]]);
    form.hidden = false;
    tryBar.hidden = false;
    introDone = true;
    skipping = false;
    body.scrollTop = body.scrollHeight;
    resolveIntro();
  };

  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      seen.disconnect();
      intro();
    }, { threshold: 0.35 });
    seen.observe(term);
  } else {
    intro();
  }

  // Clicking into the terminal skips the intro and focuses the prompt (unless selecting text)
  body.addEventListener('click', () => {
    if (window.getSelection().toString()) return;
    if (!introDone) skipping = true;
    ready.then(() => input.focus({ preventScroll: true }));
  });

  tryBar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-cmd]');
    if (!button) return;
    execute(button.dataset.cmd);
  });
})();
