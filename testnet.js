// Web4 Explorer (testnet.html): a block explorer for the Web4 testnet.
// Every block, transaction and address is generated in the browser from its number, so
// all visitors see the same chain, links keep working after a reload, and a new block
// arrives every 2 seconds. Nothing is fetched, sent or stored.
// Loaded as testnet.js?v=N: after changing it, raise N in testnet.html.

(() => {
  const GENESIS = Date.UTC(2025, 8, 1, 12); // the day Web4 was announced
  const BLOCK_MS = 2000;
  const DAY_MS = 86_400_000;
  const DAY_BLOCKS = DAY_MS / BLOCK_MS;
  const GAS_LIMIT = 30_000_000;
  const PAGE = 25;
  const MAX_RECORDS = 10_000; // like other explorers, long lists stop at 10k rows
  const SCAN_BLOCKS = DAY_BLOCKS; // how far back an address page looks for its transactions
  const SALT = { count: 0xc0de1, fee: 0xfee5, block: 0xb10c, tx: 0x7a5, hash: 0x4a54, addr: 0xadd7, account: 0xacc7, day: 0xda7, input: 0x1a7a };

  const app = document.getElementById('app');

  /* ---------- Seeded randomness ---------- */

  const mix = (h) => {
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
  };

  // mulberry32, seeded from a list of integers: the same parts always give the same numbers
  const rng = (...parts) => {
    let s = parts.reduce((h, part) => mix(h ^ part), 0x2545f491);
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const hex = (r, length) => {
    let out = '';
    while (out.length < length) out += Math.floor(r() * 2 ** 32).toString(16).padStart(8, '0');
    return out.slice(0, length);
  };

  // A 4-round Feistel network shuffles a number into a random-looking one and back.
  // Hashes and addresses start with one, so they can be read back to where they came from.
  const permute = (x, bits, inverse = false) => {
    const size = 2 ** (bits / 2);
    const round = (v, k) => mix(v ^ Math.imul(0x9e3779b9, k + 1)) % size;
    let hi = Math.floor(x / size);
    let lo = x % size;
    for (let k = 0; k < 4; k++) {
      if (inverse) [hi, lo] = [lo ^ round(hi, 3 - k), hi];
      else [hi, lo] = [lo, hi ^ round(lo, k)];
    }
    return hi * size + lo;
  };

  /* ---------- Accounts ---------- */

  // Named accounts take the first indexes. share is roughly how many of all
  // transactions touch them, for the totals on their address pages.
  const NAMED = [
    { label: 'Web4: Node 1', balance: 1_044_444.4444, share: 0 },
    { label: 'Web4: Faucet', balance: 4_444_444_444, share: 0.11 },
    { label: 'Web4: Bridge', contract: true, balance: 182_406.1207, share: 0.03 },
    { label: 'Wrapped HYPER (WHYPER)', contract: true, balance: 912_331.0841, share: 0.06 },
    { label: 'Web4 USD (W4USD)', contract: true, balance: 0, share: 0.1 },
    { label: 'Soon Token (SOON)', contract: true, balance: 0, share: 0.07 },
    { label: 'FourSwap: Router v4', contract: true, balance: 12.441, share: 0.14 },
    { label: 'Super Turbo Mega Ultra (STMU)', contract: true, balance: 3_104.6, share: 0.07 },
    { label: 'Multicall3', contract: true, balance: 0, share: 0.025 },
  ];
  const [NODE, FAUCET, BRIDGE, WHYPER, W4USD, SOON, ROUTER, STMU, MULTICALL] = NAMED.keys();
  const NULL = -1;
  const ZERO = `0x${'0'.repeat(40)}`;
  const USER0 = 1000;
  const USERS = 80_000;
  const CREATED0 = 2 ** 31; // contracts deployed on the testnet
  const TOKEN = { WHYPER, W4USD, SOON, STMU };
  const PRICE = { HYPER: 1, WHYPER: 1, W4USD: 1 / 4.44, SOON: 1 / 225 }; // in HYPER

  const addresses = new Map();
  const addressOf = (j) => {
    if (j === NULL) return ZERO;
    let address = addresses.get(j);
    if (!address) {
      address = `0x${permute(j, 32).toString(16).padStart(8, '0')}${hex(rng(j, SALT.addr), 32)}`;
      addresses.set(j, address);
    }
    return address;
  };

  // The account index behind an address, or null for one the testnet hasn't seen
  const indexOf = (address) => {
    if (address === ZERO) return NULL;
    const j = permute(parseInt(address.slice(2, 10), 16), 32, true);
    return addressOf(j) === address ? j : null;
  };

  const account = (j) => ({
    j,
    address: addressOf(j),
    label: j === NULL ? 'Null Address' : NAMED[j]?.label,
    contract: Boolean(NAMED[j]?.contract) || j >= CREATED0,
  });

  // A few heavy users (bots, mostly) and a long tail of everyone else
  const user = (r) => USER0 + Math.floor(USERS * r() ** 2.6);
  const userShare = (j) => {
    const k = j - USER0;
    return ((k + 1) / USERS) ** (1 / 2.6) - (k / USERS) ** (1 / 2.6);
  };

  /* ---------- Activity ---------- */

  const GROWTH = 120 * DAY_BLOCKS; // activity ramped up over the first few months
  const WEEKEND = 0.82;
  const trend = (n) => 24 - 22 * Math.exp(-n / GROWTH); // average transactions per block

  // Busiest in the European and American afternoon, quieter at weekends
  const rhythm = (ts) => {
    const d = new Date(ts);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    return (1 + 0.32 * Math.sin(((hour - 9) / 24) * 2 * Math.PI)) * (d.getUTCDay() % 6 ? 1 : WEEKEND);
  };

  const txCount = (n, ts) => Math.min(255, Math.max(1, Math.round(trend(n) * rhythm(ts) * (0.45 + 1.1 * rng(n, SALT.count)()))));
  const baseFee = (n) => 0.9 + 0.35 * Math.sin(n / 2300) + 0.12 * Math.sin(n / 170) + 0.06 * rng(n, SALT.fee)(); // Gwei

  // trend() summed from genesis, so totals agree with the blocks
  const totalTx = (n) => Math.round(((5 + 2 * WEEKEND) / 7) * (24 * (n + 1) - 22 * GROWTH * (1 - Math.exp(-(n + 1) / GROWTH))));

  const dayTotal = (start) => {
    const weekend = new Date(start).getUTCDay() % 6 ? 1 : WEEKEND;
    const noise = 0.96 + 0.08 * rng(start / DAY_MS, SALT.day)();
    return Math.round(DAY_BLOCKS * trend((start + DAY_MS / 2 - GENESIS) / BLOCK_MS) * weekend * noise);
  };

  /* ---------- Transactions ---------- */

  // [method name, selector, signature]
  const NATIVE = ['Transfer', '0x', null];
  const DEPLOY = ['0x60806040', '0x60806040', null];
  const FN = {
    transfer: ['Transfer', '0xa9059cbb', 'transfer(address to, uint256 amount)'],
    approve: ['Approve', '0x095ea7b3', 'approve(address spender, uint256 amount)'],
    hyperForTokens: ['Swap Exact HYPER For Tokens', '0x7ff36ab5', 'swapExactHYPERForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)'],
    tokensForHyper: ['Swap Exact Tokens For HYPER', '0x18cbafe5', 'swapExactTokensForHYPER(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)'],
    tokensForTokens: ['Swap Exact Tokens For Tokens', '0x38ed1739', 'swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)'],
    mint: ['Mint', '0xa0712d68', 'mint(uint256 quantity)'],
    burn: ['Burn', '0x42966c68', 'burn(uint256 tokenId)'],
    deposit: ['Deposit', '0xd0e30db0', 'deposit()'],
    withdraw: ['Withdraw', '0x2e1a7d4d', 'withdraw(uint256 amount)'],
    bridge: ['Bridge Out', '0x9a2ac6d5', 'bridgeOut(address to, uint32 destinationChain)'],
    aggregate: ['Aggregate3', '0x82ad56cb', 'aggregate3((address target, bool allowFailure, bytes callData)[] calls)'],
  };

  const KINDS = [
    ['transfer', 30], ['faucet', 11], ['token', 18], ['swap', 14], ['approve', 7], ['mint', 6],
    ['wrap', 4], ['unwrap', 2], ['bridge', 3], ['multicall', 2.5], ['burn', 1], ['deploy', 0.5],
  ];
  const KIND_TOTAL = KINDS.reduce((sum, [, weight]) => sum + weight, 0);
  const pickKind = (x) => {
    let left = x * KIND_TOTAL;
    return (KINDS.find(([, weight]) => (left -= weight) < 0) ?? KINDS[0])[0];
  };

  const DRIPS = [0.5, 1, 2, 5, 10, 25];

  // Log-uniform between 10^lo and 10^hi. People like round numbers, so a third get rounded.
  const amount = (r, lo, hi) => {
    const v = 10 ** (lo + (hi - lo) * r());
    if (r() < 0.35) {
      const step = 10 ** Math.floor(Math.log10(v));
      return +(Math.round(v / step) * step).toPrecision(6);
    }
    return +v.toFixed(v < 1 ? 6 : 4);
  };

  const tokenAmount = (r, sym) => {
    if (sym === 'W4USD') return amount(r, 0, 4.6);
    if (sym === 'SOON') return amount(r, 1, 6);
    return amount(r, -2, 2);
  };

  const pickToken = (r) => {
    const x = r();
    return x < 0.5 ? 'W4USD' : x < 0.8 ? 'SOON' : 'WHYPER';
  };

  const between = (r, lo, hi) => Math.round(lo + (hi - lo) * r());
  const stmuSupply = (n) => Math.round(totalTx(n) * 0.012);

  // Transaction i of block n. The hash is added by the caller, as it's the slow part.
  const makeTx = (n, i, ts, base) => {
    const r = rng(n, i, SALT.tx);
    const kind = pickKind(r());
    const tx = { n, i, ts, base, kind, from: user(r), to: null, value: 0, method: NATIVE, transfers: [], ok: true };
    let gas = [21_000, 21_000];
    let fail = 0.012;

    switch (kind) {
      case 'transfer':
        tx.to = user(r);
        if (tx.to === tx.from) tx.to += 1;
        tx.value = amount(r, -3, 2.4);
        break;
      case 'faucet':
        tx.to = tx.from;
        tx.from = FAUCET;
        tx.value = DRIPS[Math.floor(r() * DRIPS.length)];
        fail = 0;
        break;
      case 'token': {
        const sym = pickToken(r);
        tx.to = TOKEN[sym];
        tx.method = FN.transfer;
        tx.transfers.push({ from: tx.from, to: user(r), sym, amount: tokenAmount(r, sym) });
        gas = [34_000, 58_000];
        break;
      }
      case 'swap': {
        const way = r();
        const token = r() < 0.6 ? 'W4USD' : 'SOON';
        const other = token === 'W4USD' ? 'SOON' : 'W4USD';
        const [sold, bought] = way < 0.45 ? ['HYPER', token] : way < 0.8 ? [token, 'HYPER'] : [token, other];
        const paid = sold === 'HYPER' ? amount(r, -2, 2) : tokenAmount(r, sold);
        const got = +(((paid * PRICE[sold]) / PRICE[bought]) * (0.985 + 0.012 * r())).toFixed(6);
        tx.to = ROUTER;
        tx.method = sold === 'HYPER' ? FN.hyperForTokens : bought === 'HYPER' ? FN.tokensForHyper : FN.tokensForTokens;
        if (sold === 'HYPER') tx.value = paid;
        else tx.transfers.push({ from: tx.from, to: ROUTER, sym: sold, amount: paid });
        if (bought !== 'HYPER') tx.transfers.push({ from: ROUTER, to: tx.from, sym: bought, amount: got });
        tx.swap = [paid, sold, got, bought];
        gas = [110_000, 240_000];
        fail = 0.05;
        break;
      }
      case 'approve':
        tx.sym = pickToken(r);
        tx.to = TOKEN[tx.sym];
        tx.method = FN.approve;
        gas = [44_000, 46_500];
        break;
      case 'mint': {
        const quantity = 1 + Math.floor(r() ** 2 * 3);
        const first = stmuSupply(n) + i * 3;
        tx.to = STMU;
        tx.method = FN.mint;
        tx.value = +(0.0444 * quantity).toFixed(4);
        for (let k = 0; k < quantity; k++) tx.transfers.push({ from: NULL, to: tx.from, sym: 'STMU', id: first + k });
        gas = [90_000, 160_000];
        break;
      }
      case 'burn':
        tx.to = STMU;
        tx.method = FN.burn;
        tx.transfers.push({ from: tx.from, to: NULL, sym: 'STMU', id: 1 + Math.floor(r() * stmuSupply(n)) });
        gas = [32_000, 48_000];
        break;
      case 'wrap':
        tx.to = WHYPER;
        tx.method = FN.deposit;
        tx.value = amount(r, -2, 2);
        gas = [27_000, 45_000];
        break;
      case 'unwrap':
        tx.to = WHYPER;
        tx.method = FN.withdraw;
        tx.amount = amount(r, -2, 2);
        gas = [30_000, 36_000];
        break;
      case 'bridge':
        tx.to = BRIDGE;
        tx.method = FN.bridge;
        tx.value = amount(r, -1, 2.5);
        gas = [62_000, 95_000];
        break;
      case 'multicall':
        tx.to = MULTICALL;
        tx.method = FN.aggregate;
        gas = [120_000, 620_000];
        fail = 0.03;
        break;
      case 'deploy':
        tx.created = CREATED0 + ((n * 256 + i) % CREATED0);
        tx.method = DEPLOY;
        gas = [700_000, 2_800_000];
        fail = 0.02;
        break;
    }

    tx.gasUsed = between(r, ...gas);
    tx.gasLimit = gas[1] === 21_000 ? 21_000 : Math.ceil((tx.gasUsed * (1.12 + 0.4 * r())) / 1000) * 1000;
    if (r() < fail) {
      tx.ok = false;
      tx.error = kind === 'swap' ? 'FourSwap: INSUFFICIENT_OUTPUT_AMOUNT' : 'execution reverted';
      tx.gasUsed = Math.round(tx.gasUsed * (0.3 + 0.5 * r()));
    }
    tx.tip = r() < 0.12 ? 0 : +(10 ** (-3 + 2.6 * r())).toFixed(4); // Gwei
    tx.maxFee = +(base * (1.2 + 1.6 * r()) + tx.tip).toFixed(4);
    tx.fee = tx.gasUsed * (base + tx.tip) * 1e-9;
    tx.nonce = tx.from === FAUCET ? Math.round(totalTx(n) * 0.11) + i : Math.floor(r() ** 2 * 3000);
    tx.size = 110 + (tx.method[2] ? 36 + 32 * between(r, 1, 7) : 0) + (kind === 'deploy' ? 4200 : 0);
    return tx;
  };

  const txHash = (n, i) => `0x${permute(n * 256 + i, 48).toString(16).padStart(12, '0')}${hex(rng(n, i, SALT.hash), 52)}`;
  const blockHash = (n) => (n < 0 ? `0x${'0'.repeat(64)}` : `0x${hex(rng(n, SALT.block), 64)}`);

  /* ---------- Blocks ---------- */

  const blocks = new Map();
  const blockAt = (n) => {
    let block = blocks.get(n);
    if (block) return block;
    const ts = GENESIS + n * BLOCK_MS;
    const base = baseFee(n);
    const txs = Array.from({ length: txCount(n, ts) }, (_, i) => {
      const tx = makeTx(n, i, ts, base);
      tx.hash = txHash(n, i);
      return tx;
    });
    const gasUsed = txs.reduce((sum, tx) => sum + tx.gasUsed, 0);
    block = {
      n,
      ts,
      base,
      txs,
      gasUsed,
      reward: txs.reduce((sum, tx) => sum + tx.gasUsed * tx.tip, 0) * 1e-9,
      burnt: gasUsed * base * 1e-9,
      size: txs.reduce((sum, tx) => sum + tx.size, 742),
    };
    blocks.set(n, block);
    if (blocks.size > 600) blocks.delete(blocks.keys().next().value);
    return block;
  };

  const chainHead = () => Math.floor((Date.now() - GENESIS) / BLOCK_MS);
  let head = chainHead(); // the newest block on screen; it stops moving while paused

  // Newest first, skipping the first `skip`
  const latestTxs = (from, count, skip = 0) => {
    const out = [];
    for (let n = from; n >= 0 && out.length < count + skip; n--) {
      const { txs } = blockAt(n);
      for (let i = txs.length - 1; i >= 0 && out.length < count + skip; i--) out.push(txs[i]);
    }
    return out.slice(skip);
  };

  const findTx = (hash) => {
    const key = permute(parseInt(hash.slice(2, 14), 16), 48, true);
    const n = Math.floor(key / 256);
    if (n > head) return null;
    const tx = blockAt(n).txs[key % 256];
    return tx && tx.hash === hash ? tx : null;
  };

  const medianGas = (block) => {
    const prices = block.txs.map((tx) => tx.base + tx.tip).sort((a, b) => a - b);
    return prices[Math.floor(prices.length / 2)];
  };

  /* ---------- Formatting ---------- */

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const num = (v, digits = 0) => v.toLocaleString('en-US', { maximumFractionDigits: digits });
  const fixed = (v, digits) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const hyper = (v) => `${v ? num(v, v >= 1000 ? 2 : v >= 1 ? 4 : 8) : 0} HYPER`;
  const gwei = (v) => `${num(v, 9)} Gwei`;
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  const short = (s) => `${s.slice(0, 10)}…${s.slice(-8)}`;
  const plural = (v, unit) => `${num(v)} ${unit}${v === 1 ? '' : 's'}`;
  const tokenAmt = (v) => num(v, v >= 1000 ? 2 : 6);

  const ago = (ts) => {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const unit = (v, name) => `${v} ${name}${v === 1 ? '' : 's'}`;
    if (s < 60) return `${unit(s, 'sec')} ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${unit(m, 'min')} ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${unit(h, 'hr')} ${unit(m % 60, 'min')} ago`;
    return `${unit(Math.floor(h / 24), 'day')} ${unit(h % 24, 'hr')} ago`;
  };

  const utc = (ts) => {
    const d = new Date(ts);
    const pad = (v) => String(v).padStart(2, '0');
    const h = d.getUTCHours();
    return `${MONTHS[d.getUTCMonth()]}-${pad(d.getUTCDate())}-${d.getUTCFullYear()} ${pad(h % 12 || 12)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${h < 12 ? 'AM' : 'PM'} +UTC`;
  };

  /* ---------- Pieces ---------- */

  const ICONS = {
    block: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    tx: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    contract: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z"/><path d="m10.5 11.5-2 2 2 2m3-4 2 2-2 2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    done: '<path d="m5 12 5 5 9-10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    fail: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.2v.1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.1"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    flame: '<path d="M12 21c-3.9 0-7-2.7-7-6.5 0-3.4 2.6-5.6 3.9-8.5.4 2 1.6 3.2 2.6 3.7C12 7 12.6 4.5 14.5 3c.4 3 4.5 5.8 4.5 11.5 0 3.8-3.1 6.5-7 6.5Z"/>',
    gas: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
    swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c1.8.8 3 2.9 3 5.7"/>',
    node: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01"/>',
    shield: '<path d="M12 3 5 6v6c0 4.2 3 7.7 7 9 4-1.3 7-4.8 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  };
  const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  const txLink = (tx, length = 18) => `<a class="hash" href="#/tx/${tx.hash}" title="${tx.hash}">${tx.hash.slice(0, length)}…</a>`;
  const blockLink = (n) => `<a href="#/block/${n}">${n}</a>`;
  const copyBtn = (text) => `<button class="copy" type="button" data-copy="${text}" aria-label="Copy to clipboard" title="Copy">${icon('copy')}</button>`;

  // An address as it appears in lists: its name if it has one, else a shortened address
  const addrLink = (j, self) => {
    const a = account(j);
    const inner = `${a.contract ? icon('contract') : ''}<span>${a.label ? esc(a.label) : short(a.address)}</span>`;
    const title = a.label ? `${esc(a.label)}\n${a.address}` : a.address;
    if (j === self) return `<span class="addr" title="${title}">${inner}</span>`;
    return `<a class="addr" href="#/address/${a.address}" title="${title}">${inner}</a>`;
  };

  // An address as it appears on detail pages: in full, with its name and a copy button
  const fullAddr = (j) => {
    const a = account(j);
    return `${a.contract ? `${icon('contract', 'ico--muted')} ` : ''}<a class="mono" href="#/address/${a.address}">${a.address}</a>${a.label ? ` <span class="muted">(${esc(a.label)})</span>` : ''}${copyBtn(a.address)}`;
  };

  const toLink = (tx, self) => {
    if (tx.to !== null) return addrLink(tx.to, self);
    const address = addressOf(tx.created);
    return `<a class="addr" href="#/address/${address}" title="New contract\n${address}">${icon('contract')}<span>Contract Creation</span></a>`;
  };

  const tokenLink = (sym) => `<a href="#/address/${addressOf(TOKEN[sym])}">${sym}</a>`;

  const row = (label, value, hint) => `
    <div class="row">
      <dt>${icon('info', 'ico--muted')}<span${hint ? ` title="${hint}"` : ''}>${label}:</span></dt>
      <dd>${value}</dd>
    </div>`;

  const pageHead = (title, extra = '') => `<div class="page-head"><h1 class="page-title">${title}</h1>${extra}</div>`;

  const pager = (base, page, pages) => {
    const link = (p, label, name) => (p < 1 || p > pages || p === page
      ? `<span class="pager__btn is-off" aria-hidden="true">${label}</span>`
      : `<a class="pager__btn" href="#/${base}/${p}" aria-label="${name}">${label}</a>`);
    return `<nav class="pager" aria-label="Pagination">
      ${link(1, 'First', 'First page')}${link(page - 1, icon('left'), 'Previous page')}
      <span class="pager__now">Page ${num(page)} of ${num(pages)}</span>
      ${link(page + 1, icon('right'), 'Next page')}${link(pages, 'Last', 'Last page')}
    </nav>`;
  };

  const clampPage = (p, pages) => Math.min(pages, Math.max(1, Number(p) || 1));

  const confirmations = (n) => `<span class="badge badge--muted" data-confirm="${n}">${plural(head - n + 1, 'Block Confirmation')}</span>`;

  const searchForm = () => `
    <form class="search search--hero" role="search" data-search>
      <label class="sr-only" for="search-filter">Search in</label>
      <select class="search__filter" id="search-filter" name="filter">
        <option value="all">All Filters</option>
        <option value="address">Addresses</option>
        <option value="tx">Txn Hash</option>
        <option value="block">Block</option>
      </select>
      <label class="sr-only" for="search-hero">Search</label>
      <input id="search-hero" name="q" type="search" placeholder="Search by Address / Txn Hash / Block"
             autocomplete="off" spellcheck="false" autocapitalize="off">
      <button type="submit" aria-label="Search">${icon('search')}</button>
    </form>`;

  /* ---------- Rows ---------- */

  const TX_HEAD = (showBlock = true) => `<tr>
    <th scope="col">Transaction Hash</th><th scope="col">Method</th>${showBlock ? '<th scope="col">Block</th>' : ''}
    <th scope="col">Age</th><th scope="col">From</th><th scope="col"><span class="sr-only">Direction</span></th>
    <th scope="col">To</th><th scope="col">Amount</th><th scope="col">Txn Fee</th>
  </tr>`;

  const txRow = (tx, { isNew = false, self = null, showBlock = true } = {}) => {
    const io = tx.from === self ? (tx.to === self ? 'self' : 'out') : 'in';
    const dir = self === null
      ? `<span class="dir">${icon('arrow')}</span>`
      : `<span class="io io--${io}">${io.toUpperCase()}</span>`;
    return `<tr${isNew ? ' class="is-new"' : ''}>
      <td>${tx.ok ? '' : `<span class="fail-mark" title="Failed: ${esc(tx.error)}">${icon('fail')}</span>`}${txLink(tx)}</td>
      <td><span class="method" title="${esc(tx.method[0])}">${esc(tx.method[0])}</span></td>
      ${showBlock ? `<td>${blockLink(tx.n)}</td>` : ''}
      <td data-ts="${tx.ts}">${ago(tx.ts)}</td>
      <td>${addrLink(tx.from, self)}</td>
      <td>${dir}</td>
      <td>${toLink(tx, self)}</td>
      <td>${hyper(tx.value)}</td>
      <td class="muted small">${num(tx.fee, 8)}</td>
    </tr>`;
  };

  const BLOCK_HEAD = `<tr>
    <th scope="col">Block</th><th scope="col">Age</th><th scope="col">Txn</th><th scope="col">Fee Recipient</th>
    <th scope="col">Gas Used</th><th scope="col">Gas Limit</th><th scope="col">Base Fee</th>
    <th scope="col">Reward</th><th scope="col">Burnt Fees (HYPER)</th>
  </tr>`;

  const blockRow = (b, isNew, self = null) => `<tr${isNew ? ' class="is-new"' : ''}>
    <td>${blockLink(b.n)}</td>
    <td data-ts="${b.ts}">${ago(b.ts)}</td>
    <td><a href="#/block/${b.n}">${b.txs.length}</a></td>
    <td>${addrLink(NODE, self)}</td>
    <td>${num(b.gasUsed)} <span class="muted small">(${pct(b.gasUsed / GAS_LIMIT)})</span>
      <span class="meter"><span style="width:${Math.max(1, (b.gasUsed / GAS_LIMIT) * 100).toFixed(1)}%"></span></span></td>
    <td>${num(GAS_LIMIT)}</td>
    <td>${num(b.base, 4)} Gwei</td>
    <td>${num(b.reward, 5)} HYPER</td>
    <td>${icon('flame', 'ico--burn')} ${num(b.burnt, 6)}</td>
  </tr>`;

  const blockItem = (b, isNew) => `
    <li class="feed__item${isNew ? ' is-new' : ''}">
      <span class="feed__icon">${icon('block')}</span>
      <div class="feed__cell">
        ${blockLink(b.n)}
        <span class="muted small" data-ts="${b.ts}">${ago(b.ts)}</span>
      </div>
      <div class="feed__cell">
        <span>Fee Recipient ${addrLink(NODE)}</span>
        <span class="small"><a href="#/block/${b.n}" title="Transactions in this block">${plural(b.txs.length, 'txn')}</a> <span class="muted">in 2 secs</span></span>
      </div>
      <span class="pill" title="Block reward">${num(b.reward, 5)} HYPER</span>
    </li>`;

  const txItem = (tx, isNew) => `
    <li class="feed__item${isNew ? ' is-new' : ''}">
      <span class="feed__icon">${icon('tx')}</span>
      <div class="feed__cell">
        ${txLink(tx, 14)}
        <span class="muted small" data-ts="${tx.ts}">${ago(tx.ts)}</span>
      </div>
      <div class="feed__cell">
        <span>From ${addrLink(tx.from)}</span>
        <span>To ${toLink(tx)}</span>
      </div>
      <span class="pill" title="Amount">${num(tx.value, 5)} HYPER</span>
    </li>`;

  // Lists hold still while the pointer or focus is on them, so rows don't move under a click
  const busy = (el) => el.matches(':hover') || el.contains(document.activeElement);

  /* ---------- Chart ---------- */

  const niceStep = (raw) => {
    const pow = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((step) => step >= raw);
  };

  const renderChart = (el) => {
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const days = Array.from({ length: 14 }, (_, k) => today - (14 - k) * DAY_MS).map((start) => ({ start, total: dayTotal(start) }));
    const values = days.map((d) => d.total);
    const step = niceStep((Math.max(...values) - Math.min(...values)) / 2);
    const lo = Math.floor(Math.min(...values) / step) * step;
    const hi = Math.ceil(Math.max(...values) / step) * step;
    const [W, H, L, R, T, B] = [320, 112, 34, 6, 8, 20];
    const x = (k) => L + (k / (days.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const dateLabel = (start, opts) => new Date(start).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

    const ticks = [];
    for (let v = lo; v <= hi + 1; v += step) ticks.push(v);
    const line = days.map((d, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(d.total).toFixed(1)}`).join('');
    const labels = [0, 7, 13].map((k) => `<text class="chart__tick" x="${x(k)}" y="${H - 4}" text-anchor="${k ? (k === 13 ? 'end' : 'middle') : 'start'}">${dateLabel(days[k].start, { month: 'short', day: 'numeric' })}</text>`);

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" tabindex="0" role="img"
           aria-label="Daily transactions, last 14 days: from ${num(values[0])} to ${num(values[13])}. Use the arrow keys to read each day.">
        ${ticks.map((v) => `<line class="chart__grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
          <text class="chart__tick" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${Math.round(v / 1000)}k</text>`).join('')}
        <path class="chart__area" d="${line}L${x(13)},${H - B}L${x(0)},${H - B}Z"/>
        <path class="chart__line" d="${line}"/>
        ${labels.join('')}
        <line class="chart__cross" y1="${T}" y2="${H - B}" visibility="hidden"/>
        <circle class="chart__dot" r="4" visibility="hidden"/>
      </svg>
      <div class="chart__tip" hidden></div>
      <table class="sr-only">
        <caption>Transactions per day</caption>
        <tr><th scope="col">Day</th><th scope="col">Transactions</th></tr>
        ${days.map((d) => `<tr><td>${dateLabel(d.start, { dateStyle: 'medium' })}</td><td>${num(d.total)}</td></tr>`).join('')}
      </table>`;

    const svg = el.querySelector('svg');
    const tip = el.querySelector('.chart__tip');
    const cross = svg.querySelector('.chart__cross');
    const dot = svg.querySelector('.chart__dot');
    let current = days.length - 1;

    const show = (k) => {
      current = k;
      const d = days[k];
      cross.setAttribute('x1', x(k));
      cross.setAttribute('x2', x(k));
      dot.setAttribute('cx', x(k));
      dot.setAttribute('cy', y(d.total));
      cross.setAttribute('visibility', 'visible');
      dot.setAttribute('visibility', 'visible');
      tip.innerHTML = `${dateLabel(d.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}<br>Transactions: <b>${num(d.total)}</b>`;
      tip.style.left = `${(x(k) / W) * 100}%`;
      tip.style.top = `${(y(d.total) / H) * 100}%`;
      tip.style.transform = `translate(${k < 3 ? '-12%' : k > 10 ? '-88%' : '-50%'}, calc(-100% - 10px))`;
      tip.hidden = false;
    };

    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };

    svg.addEventListener('pointermove', (event) => {
      const box = svg.getBoundingClientRect();
      const px = ((event.clientX - box.left) / box.width) * W;
      show(Math.min(days.length - 1, Math.max(0, Math.round(((px - L) / (W - L - R)) * (days.length - 1)))));
    });
    svg.addEventListener('pointerleave', () => { if (document.activeElement !== svg) hide(); });
    svg.addEventListener('focus', () => show(current));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (event) => {
      const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (!move) return;
      event.preventDefault();
      show(Math.min(days.length - 1, Math.max(0, current + move)));
    });
  };

  /* ---------- Views ---------- */

  let view = null; // { live(prevHead) } for the page on screen
  let viewId = 0;

  const setTitle = (title) => {
    document.title = title ? `${title} | Web4 Explorer` : 'Web4 Testnet Explorer';
  };

  const stat = (id, name, label) => `
    <div class="stat">
      <span class="stat__icon">${icon(name)}</span>
      <div><p class="stat__label">${label}</p><p class="stat__value" id="${id}"></p></div>
    </div>`;

  const home = () => {
    setTitle('');
    app.innerHTML = `
      <section class="hero">
        <div class="wrap hero__inner">
          <div class="hero__main">
            <h1 class="hero__title">The Web4 Testnet Explorer</h1>
            ${searchForm()}
          </div>
          <aside class="hero__promo" aria-label="Testnet faucet">
            <p class="hero__promo-tag">Testnet faucet</p>
            <p class="hero__promo-title">Get free testnet HYPER</p>
            <p class="hero__promo-copy">Think of a number. The faucet sends it to you, confirmed by 1/1 nodes.</p>
            <a class="hero__promo-link" href="build.html#quickstart">Start building ${icon('arrow')}</a>
          </aside>
        </div>
      </section>

      <div class="wrap">
        <section class="card stats" aria-label="Network statistics">
          <div class="stats__col">${stat('stat-tx', 'swap', 'Transactions')}${stat('stat-gas', 'gas', 'Med gas price')}</div>
          <div class="stats__col">${stat('stat-active', 'users', 'Active addresses (24h)')}${stat('stat-nodes', 'node', 'Validators')}</div>
          <div class="stats__col">${stat('stat-final', 'shield', 'Last finalized block')}${stat('stat-safe', 'lock', 'Last safe block')}</div>
          <div class="stats__col stats__chart">
            <p class="stat__label">Transaction history in 14 days</p>
            <div class="chart" id="chart"></div>
          </div>
        </section>

        <div class="duo">
          <section class="card" aria-labelledby="latest-blocks">
            <h2 class="card__title" id="latest-blocks">Latest Blocks</h2>
            <ul class="feed" id="feed-blocks"></ul>
            <a class="card__foot" href="#/blocks">View all blocks ${icon('arrow')}</a>
          </section>
          <section class="card" aria-labelledby="latest-txs">
            <h2 class="card__title" id="latest-txs">Latest Transactions</h2>
            <ul class="feed" id="feed-txs"></ul>
            <a class="card__foot" href="#/txs">View all transactions ${icon('arrow')}</a>
          </section>
        </div>
      </div>`;

    const fill = (prev) => {
      const recent = Array.from({ length: 30 }, (_, k) => blockAt(head - k).txs.length);
      const tps = recent.reduce((a, b) => a + b, 0) / recent.length / (BLOCK_MS / 1000);
      const yesterday = Math.floor(Date.now() / DAY_MS) * DAY_MS - DAY_MS;
      const values = {
        'stat-tx': `${fixed(totalTx(head) / 1e6, 2)} M <span class="muted">(${tps.toFixed(1)} TPS)</span>`,
        'stat-gas': `${num(medianGas(blockAt(head)), 3)} Gwei`,
        'stat-active': num(Math.round(dayTotal(yesterday) * 0.19)),
        'stat-nodes': '1 <span class="muted">(1/1 online)</span>',
        'stat-final': blockLink(head),
        'stat-safe': blockLink(head),
      };
      Object.entries(values).forEach(([id, html]) => { document.getElementById(id).innerHTML = html; });

      const blockFeed = document.getElementById('feed-blocks');
      const txFeed = document.getElementById('feed-txs');
      if (!busy(blockFeed)) blockFeed.innerHTML = Array.from({ length: 6 }, (_, k) => blockItem(blockAt(head - k), head - k > prev)).join('');
      if (!busy(txFeed)) txFeed.innerHTML = latestTxs(head, 6).map((tx) => txItem(tx, tx.n > prev)).join('');
    };

    fill(head);
    renderChart(document.getElementById('chart'));
    view = { live: fill };
  };

  const txList = (p) => {
    const pages = MAX_RECORDS / PAGE;
    const page = clampPage(p, pages);
    setTitle(page > 1 ? `Transactions (page ${page})` : 'Transactions');
    app.innerHTML = `
      <div class="wrap">
        ${pageHead('Transactions')}
        <section class="card">
          <div class="card__bar"><p id="count"></p>${pager('txs', page, pages)}</div>
          <div class="table-wrap">
            <table class="table"><thead>${TX_HEAD()}</thead><tbody id="rows"></tbody></table>
          </div>
          <div class="card__bar card__bar--end">${pager('txs', page, pages)}</div>
        </section>
      </div>`;

    const fill = (prev) => {
      document.getElementById('count').innerHTML = `More than ${num(totalTx(head))} transactions found <span class="muted">(Showing the last 10k records)</span>`;
      const rows = document.getElementById('rows');
      if (!busy(rows)) rows.innerHTML = latestTxs(head, PAGE, (page - 1) * PAGE).map((tx) => txRow(tx, { isNew: tx.n > prev })).join('');
    };

    fill(head);
    if (page === 1) view = { live: fill };
  };

  const blockList = (p) => {
    const pages = Math.ceil((head + 1) / PAGE);
    const page = clampPage(p, pages);
    setTitle(page > 1 ? `Blocks (page ${page})` : 'Blocks');
    app.innerHTML = `
      <div class="wrap">
        ${pageHead('Blocks')}
        <section class="card">
          <div class="card__bar"><p id="count"></p>${pager('blocks', page, pages)}</div>
          <div class="table-wrap">
            <table class="table"><thead>${BLOCK_HEAD}</thead><tbody id="rows"></tbody></table>
          </div>
          <div class="card__bar card__bar--end">${pager('blocks', page, pages)}</div>
        </section>
      </div>`;

    const fill = (prev) => {
      const top = head - (page - 1) * PAGE;
      document.getElementById('count').innerHTML = `Total of ${num(head + 1)} blocks <span class="muted">(Showing blocks between #${Math.max(0, top - PAGE + 1)} to #${top})</span>`;
      const rows = document.getElementById('rows');
      if (busy(rows)) return;
      rows.innerHTML = Array.from({ length: Math.min(PAGE, top + 1) }, (_, k) => blockRow(blockAt(top - k), top - k > prev)).join('');
    };

    fill(head);
    if (page === 1) view = { live: fill };
  };

  // Words of a transaction's input data, as an ABI decoder would show them
  const word = (s) => s.padStart(64, '0');
  const uintWord = (v) => word((BigInt(Math.round(v * 1e6)) * 10n ** 12n).toString(16));
  const intWord = (v) => word(Math.round(v).toString(16));
  const addrWord = (j) => word(addressOf(j).slice(2));

  const inputData = (tx) => {
    const [, selector, signature] = tx.method;
    if (!signature) return tx.kind === 'deploy' ? `0x60806040${hex(rng(tx.n, tx.i, SALT.input), 1200)}` : '0x';
    const deadline = intWord(tx.ts / 1000 + 1200);
    const path = (a, b) => [intWord(2), addrWord(TOKEN[a] ?? WHYPER), addrWord(TOKEN[b] ?? WHYPER)];
    let words;
    switch (tx.method) {
      case FN.transfer: words = [addrWord(tx.transfers[0].to), uintWord(tx.transfers[0].amount)]; break;
      case FN.approve: words = [addrWord(ROUTER), 'f'.repeat(64)]; break;
      case FN.hyperForTokens: words = [uintWord(tx.swap[2] * 0.99), intWord(0x80), addrWord(tx.from), deadline, ...path('HYPER', tx.swap[3])]; break;
      case FN.tokensForHyper:
      case FN.tokensForTokens: words = [uintWord(tx.swap[0]), uintWord(tx.swap[2] * 0.99), intWord(0xa0), addrWord(tx.from), deadline, ...path(tx.swap[1], tx.swap[3])]; break;
      case FN.mint: words = [intWord(tx.transfers.length)]; break;
      case FN.burn: words = [intWord(tx.transfers[0].id)]; break;
      case FN.deposit: words = []; break;
      case FN.withdraw: words = [uintWord(tx.amount)]; break;
      case FN.bridge: words = [addrWord(tx.from), intWord(4)]; break;
      default: {
        const r = rng(tx.n, tx.i, SALT.input);
        words = [intWord(0x20), intWord(3), ...Array.from({ length: 6 }, () => hex(r, 64))];
      }
    }
    return [`Function: ${signature}`, '', `MethodID: ${selector}`, ...words.map((w, k) => `[${k}]:  ${w}`)].join('\n');
  };

  const txAction = (tx) => {
    const amt = (v, sym) => `<b>${tokenAmt(v)}</b> ${sym === 'HYPER' ? 'HYPER' : tokenLink(sym)}`;
    switch (tx.kind) {
      case 'swap': return `Swap ${amt(tx.swap[0], tx.swap[1])} For ${amt(tx.swap[2], tx.swap[3])} On ${addrLink(ROUTER)}`;
      case 'token': return `Transfer ${amt(tx.transfers[0].amount, tx.transfers[0].sym)} To ${addrLink(tx.transfers[0].to)}`;
      case 'approve': return `Approve ${tokenLink(tx.sym)} For Trade On ${addrLink(ROUTER)}`;
      case 'wrap': return `Wrap ${amt(tx.value, 'HYPER')} For ${amt(tx.value, 'WHYPER')}`;
      case 'unwrap': return `Unwrap ${amt(tx.amount, 'WHYPER')} For ${amt(tx.amount, 'HYPER')}`;
      case 'mint': return `Mint <b>${tx.transfers.length}</b> ${tokenLink('STMU')}`;
      case 'burn': return `Burn ${tokenLink('STMU')} #${tx.transfers[0].id}`;
      case 'bridge': return `Bridge ${amt(tx.value, 'HYPER')} To Web4 Mainnet`;
      default: return '';
    }
  };

  const transfersRows = (tx) => {
    const fungible = tx.transfers.filter((t) => t.amount !== undefined);
    const nfts = tx.transfers.filter((t) => t.id !== undefined);
    const list = (items, what) => `<ul class="transfers">${items.map((t) => `
      <li><span class="muted">From</span> ${addrLink(t.from)} <span class="muted">To</span> ${addrLink(t.to)}
        <span class="muted">For</span> ${what(t)}</li>`).join('')}</ul>`;
    return (fungible.length ? row('WRC-20 Tokens Transferred', list(fungible, (t) => `<b>${tokenAmt(t.amount)}</b> ${tokenLink(t.sym)}`), 'Token transfers in this transaction') : '')
      + (nfts.length ? row('WRC-4444 Tokens Transferred', list(nfts, (t) => `${tokenLink('STMU')} <b>#${t.id}</b>`), 'NFT transfers in this transaction') : '');
  };

  const txView = (raw) => {
    const hash = raw.toLowerCase();
    const tx = findTx(hash);
    if (!tx) return notFound(raw, 'Sorry, we are unable to locate this transaction hash.');
    setTitle(`Transaction ${short(hash)}`);
    const action = tx.ok ? txAction(tx) : '';
    const to = tx.to === null ? null : account(tx.to);
    const status = tx.ok
      ? `<span class="badge badge--ok">${icon('check')} Success</span>`
      : `<span class="badge badge--bad">${icon('fail')} Failed</span> <span class="bad small">Fail with error '${esc(tx.error)}'</span>`;
    const burnt = tx.gasUsed * tx.base * 1e-9;
    const savings = tx.gasUsed * (tx.maxFee - tx.base - tx.tip) * 1e-9;

    app.innerHTML = `
      <div class="wrap">
        ${pageHead('Transaction Details')}
        <section class="card">
          <dl class="rows">
            ${row('Transaction Hash', `<span class="mono">${hash}</span>${copyBtn(hash)}`, 'A unique identifier for this transaction')}
            ${row('Status', status, 'Whether the transaction executed successfully')}
            ${row('Block', `${blockLink(tx.n)} ${confirmations(tx.n)}`, 'The block this transaction was included in')}
            ${row('Timestamp', `${icon('clock', 'ico--muted')} <span data-ts="${tx.ts}">${ago(tx.ts)}</span> <span class="muted">(${utc(tx.ts)})</span>`, 'When the block was produced')}
          </dl>
          <hr class="sep">
          <dl class="rows">
            ${action ? row('Transaction Action', action, 'A summary of what this transaction did') : ''}
            ${row('From', fullAddr(tx.from), 'The sending party')}
            ${tx.to === null
              ? row('To', `[ ${fullAddr(tx.created)} <span class="muted">Created</span> ]`, 'The contract this transaction created')
              : row(to.contract ? 'Interacted With (To)' : 'To', fullAddr(tx.to), 'The receiving party')}
            ${tx.ok ? transfersRows(tx) : ''}
          </dl>
          <hr class="sep">
          <dl class="rows">
            ${row('Value', hyper(tx.value), 'HYPER sent with this transaction')}
            ${row('Transaction Fee', hyper(tx.fee), 'Gas used times the gas price')}
            ${row('Gas Price', `${gwei(tx.base + tx.tip)} <span class="muted">(${num((tx.base + tx.tip) * 1e-9, 18)} HYPER)</span>`, 'Cost per unit of gas')}
          </dl>
          <details class="more">
            <summary>${icon('plus')}<span class="more__more">More details</span><span class="more__less">Fewer details</span></summary>
            <dl class="rows">
              ${row('Gas Limit & Usage by Txn', `${num(tx.gasLimit)} <span class="muted">|</span> ${num(tx.gasUsed)} <span class="muted">(${pct(tx.gasUsed / tx.gasLimit)})</span>`, 'Maximum gas allowed, and gas actually used')}
              ${row('Gas Fees', `<span class="muted">Base:</span> ${gwei(tx.base)} <span class="muted">| Max:</span> ${gwei(tx.maxFee)} <span class="muted">| Max Priority:</span> ${gwei(tx.tip)}`, 'EIP-1559 fee fields')}
              ${row('Burnt & Txn Savings Fees', `${icon('flame', 'ico--burn')} <span class="muted">Burnt:</span> ${hyper(burnt)} <span class="muted">· Txn Savings:</span> ${hyper(savings)}`, 'Base fee burnt, and what was saved against the max fee')}
              ${row('Other Attributes', `<span class="badges"><span class="badge badge--muted">Txn Type: 2 (EIP-1559)</span><span class="badge badge--muted">Nonce: ${num(tx.nonce)}</span><span class="badge badge--muted">Position In Block: ${tx.i}</span></span>`)}
              ${row('Input Data', `<pre class="input">${esc(inputData(tx))}</pre>`, 'Data sent along with the transaction')}
            </dl>
          </details>
        </section>
      </div>`;
  };

  const blockView = (value) => {
    const n = Number(value);
    if (n > head) {
      const wait = Math.round(((n - head) * BLOCK_MS) / 1000);
      return notFound(value, `Block #${n} hasn't been produced yet. At one block every 2 seconds, it's ${plural(wait, 'second')} away.`);
    }
    const b = blockAt(n);
    setTitle(`Block #${n}`);
    const steps = () => `${n > 0 ? `<a href="#/block/${n - 1}" aria-label="Previous block">${icon('left')}</a>` : `<span aria-hidden="true">${icon('left')}</span>`}${
      n < head ? `<a href="#/block/${n + 1}" aria-label="Next block">${icon('right')}</a>` : `<span aria-hidden="true">${icon('right')}</span>`}`;
    const extra = 'web4/v4.0.0 (1/1)';

    app.innerHTML = `
      <div class="wrap">
        ${pageHead(`Block <span class="muted">#${n}</span>`)}
        <section class="card">
          <dl class="rows">
            ${row('Block Height', `<b>${n}</b><span class="steps" id="steps">${steps()}</span>`, 'Also known as the block number')}
            ${row('Status', `<span class="badge badge--ok">${icon('check')} Finalized</span>`, 'Finalized blocks cannot be changed')}
            ${row('Timestamp', `${icon('clock', 'ico--muted')} <span data-ts="${b.ts}">${ago(b.ts)}</span> <span class="muted">(${utc(b.ts)})</span>`, 'When the block was produced')}
            ${row('Proposed On', `Block proposed on slot ${n}, epoch ${Math.floor(n / 32)}`, 'The slot and epoch of this block')}
          </dl>
          <hr class="sep">
          <dl class="rows">
            ${row('Transactions', `<button class="linkish" type="button" data-scroll="block-txs">${plural(b.txs.length, 'transaction')}</button> in this block`, 'Transactions included in this block')}
            ${row('Fee Recipient', `${addrLink(NODE)} <span class="muted">in 2 secs</span>`, 'Who received this block’s fees')}
            ${row('Block Reward', `${hyper(b.reward)} <span class="muted">(0 + ${num(b.reward + b.burnt, 8)} - ${num(b.burnt, 8)})</span>`, 'Priority fees paid to the fee recipient')}
            ${row('Size', `${num(b.size)} bytes`, 'Size of the block')}
            ${row('Gas Used', `${num(b.gasUsed)} <span class="muted">(${pct(b.gasUsed / GAS_LIMIT)})</span>`, 'Gas used by all transactions in this block')}
            ${row('Gas Limit', num(GAS_LIMIT), 'Most gas a block can hold')}
            ${row('Base Fee Per Gas', `${num(b.base * 1e-9, 18)} HYPER <span class="muted">(${gwei(b.base)})</span>`, 'Minimum fee per unit of gas')}
            ${row('Burnt Fees', `${icon('flame', 'ico--burn')} ${hyper(b.burnt)}`, 'Base fees burnt in this block')}
            ${row('Extra Data', `${extra} <span class="muted">(Hex: 0x${[...extra].map((c) => c.charCodeAt(0).toString(16)).join('')})</span>`, 'Data the node added to the block')}
          </dl>
          <hr class="sep">
          <dl class="rows">
            ${row('Hash', `<span class="mono">${blockHash(n)}</span>${copyBtn(blockHash(n))}`, 'The hash of this block')}
            ${row('Parent Hash', n > 0 ? `<a class="mono" href="#/block/${n - 1}">${blockHash(n - 1)}</a>` : `<span class="mono">${blockHash(-1)}</span>`, 'The hash of the block before it')}
          </dl>
        </section>

        <section class="card" id="block-txs">
          <h2 class="card__title">Transactions <span class="muted">(${b.txs.length})</span></h2>
          <div class="table-wrap">
            <table class="table"><thead>${TX_HEAD(false)}</thead>
              <tbody>${b.txs.map((tx) => txRow(tx, { showBlock: false })).join('')}</tbody>
            </table>
          </div>
        </section>
      </div>`;

    view = { live: () => { document.getElementById('steps').innerHTML = steps(); } };
  };

  const addressView = (raw) => {
    const address = raw.toLowerCase();
    const j = indexOf(address);
    const a = j === null ? { address, contract: false } : account(j);
    const named = NAMED[j];
    const r = rng(j ?? 0, SALT.account);
    const known = j !== null && j !== NULL;
    const balance = !known ? 0 : named ? named.balance : +(10 ** (-1 + 4.4 * r())).toFixed(4);
    const estimate = !known ? 0 : named ? named.share * totalTx(head)
      : j >= CREATED0 ? 1 + r() * 200 : userShare(j) * 1.3 * totalTx(head);
    const firstSeen = !known ? null : named ? GENESIS : GENESIS + Math.floor(r() * (head - DAY_BLOCKS)) * BLOCK_MS;
    const sym = Object.keys(TOKEN).find((s) => TOKEN[s] === j);
    const produces = j === NODE;
    setTitle(`${a.contract ? 'Contract' : 'Address'} ${short(address)}`);

    app.innerHTML = `
      <div class="wrap">
        ${pageHead(`${a.contract ? 'Contract' : 'Address'} <span class="mono">${address}</span>${copyBtn(address)}`,
          a.label ? `<span class="badge badge--muted">${esc(a.label)}</span>` : '')}
        <div class="duo">
          <section class="card">
            <h2 class="card__title">Overview</h2>
            <dl class="overview">
              ${row('HYPER Balance', hyper(balance))}
              ${sym ? row('Token Tracker', `<a href="#/address/${address}">${esc(a.label)}</a>`) : ''}
              ${row('Type', a.contract ? 'Contract' : 'Account')}
            </dl>
          </section>
          <section class="card">
            <h2 class="card__title">More Info</h2>
            <dl class="overview">
              ${row('Name Tag', a.label && j !== NULL ? esc(a.label) : '<span class="muted">Not available</span>')}
              ${row(produces ? 'Blocks Produced' : 'Transactions', num(produces ? head + 1 : Math.round(estimate)))}
              ${row('First Seen', firstSeen ? `${ago(firstSeen)} <span class="muted">(${utc(firstSeen)})</span>` : '<span class="muted">Never</span>')}
            </dl>
          </section>
        </div>

        <section class="card">
          <div class="tabs"><span class="tab">${produces ? 'Produced Blocks' : 'Transactions'}</span></div>
          <div class="card__bar"><p id="count"><span class="spinner" aria-hidden="true"></span>Loading…</p></div>
          <div class="table-wrap">
            <table class="table"><thead>${produces ? BLOCK_HEAD : TX_HEAD()}</thead><tbody id="rows"></tbody></table>
          </div>
        </section>
      </div>`;

    const count = document.getElementById('count');
    const rows = document.getElementById('rows');

    // The fee recipient's tab lists the blocks it produced, live
    if (produces) {
      const fill = (prev) => {
        count.textContent = `Latest ${PAGE} from a total of ${num(head + 1)} blocks`;
        if (!busy(rows)) rows.innerHTML = Array.from({ length: PAGE }, (_, k) => blockRow(blockAt(head - k), head - k > prev, NODE)).join('');
      };
      fill(head);
      view = { live: fill };
      return;
    }

    const empty = (text) => `<tr class="table__empty"><td colspan="9">${text}</td></tr>`;
    if (!known) {
      count.textContent = 'No transactions found';
      rows.innerHTML = empty('There are no matching entries');
      return;
    }

    // Look back through recent blocks in small batches, so the page stays responsive
    const found = [];
    const id = viewId;
    const stop = Math.max(0, head - SCAN_BLOCKS);
    let n = head;
    const scan = () => {
      if (id !== viewId) return;
      for (const until = Math.max(stop, n - 600); n > until && found.length < PAGE; n--) {
        const ts = GENESIS + n * BLOCK_MS;
        const base = baseFee(n);
        const cached = blocks.get(n);
        for (let i = txCount(n, ts) - 1; i >= 0 && found.length < PAGE; i--) {
          const tx = cached ? cached.txs[i] : makeTx(n, i, ts, base);
          if (tx.from !== j && tx.to !== j && tx.created !== j) continue;
          tx.hash ??= txHash(n, i);
          found.push(tx);
        }
      }
      if (found.length < PAGE && n > stop) {
        setTimeout(scan, 0);
        return;
      }
      const total = Math.max(found.length, Math.round(estimate));
      count.textContent = found.length ? `Latest ${found.length} from a total of ${num(total)} transactions` : 'No transactions in the last 24 hours';
      rows.innerHTML = found.length ? found.map((tx) => txRow(tx, { self: j })).join('') : empty('There are no matching entries');
    };
    scan();
  };

  const notFound = (query, message = 'Sorry! This is an invalid search string.') => {
    setTitle('Search not found');
    app.innerHTML = `
      <div class="wrap">
        <section class="card empty">
          <p class="empty__code">Search not found</p>
          <h1 class="empty__title">Oops! The search string you entered was: <span class="mono">${esc(query)}</span></h1>
          <p class="muted">${esc(message)}</p>
          <a class="btn" href="#/">Back to home</a>
        </section>
      </div>`;
  };

  /* ---------- Search ---------- */

  const go = (path) => { location.hash = `#/${path}`; };

  const search = (raw, filter = 'all') => {
    const q = raw.trim().toLowerCase().replace(/,/g, '');
    if (!q) return;
    const allows = (type) => filter === 'all' || filter === type;
    if (/^0x[0-9a-f]{64}$/.test(q)) {
      if (allows('tx') && findTx(q)) return go(`tx/${q}`);
      if (allows('block')) {
        for (let n = head; n >= Math.max(0, head - 10_000); n--) if (blockHash(n) === q) return go(`block/${n}`);
      }
      if (allows('tx')) return go(`tx/${q}`);
    } else if (/^0x[0-9a-f]{40}$/.test(q) && allows('address')) {
      return go(`address/${q}`);
    } else if (/^\d+$/.test(q) && allows('block')) {
      return go(`block/${Number(q)}`);
    }
    return go(`search/${encodeURIComponent(raw.trim())}`);
  };

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-search]');
    if (!form) return;
    event.preventDefault();
    search(form.elements.q.value, form.elements.filter?.value);
    form.elements.q.blur();
    if (!form.closest('#app')) form.reset();
  });

  /* ---------- Routing ---------- */

  const ROUTES = [
    [/^$/, home],
    [/^txs(?:\/(\d+))?$/, txList],
    [/^blocks(?:\/(\d+))?$/, blockList],
    [/^tx\/(0x[0-9a-fA-F]{64})$/, txView],
    [/^block\/(\d+)$/, blockView],
    [/^address\/(0x[0-9a-fA-F]{40})$/, addressView],
    [/^search\/(.*)$/, (q) => {
      try { notFound(decodeURIComponent(q)); } catch { notFound(q); }
    }],
  ];

  const NAV = { '': 'home', txs: 'txs', tx: 'txs', blocks: 'blocks', block: 'blocks' };

  const route = () => {
    const path = location.hash.replace(/^#\/?/, '');
    viewId += 1;
    view = null;
    const match = ROUTES.find(([pattern]) => pattern.test(path));
    if (match) match[1](...path.match(match[0]).slice(1));
    else notFound(path, 'Sorry, this page does not exist.');

    document.body.classList.toggle('is-home', path === '');
    const section = NAV[path.split('/')[0]];
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.dataset.nav === section) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  };

  window.addEventListener('hashchange', route);

  /* ---------- Live updates ---------- */

  const liveButton = document.getElementById('live');
  const gas = document.getElementById('gas');
  let live = true;

  const refreshGas = () => { gas.textContent = `${num(medianGas(blockAt(head)), 3)} Gwei`; };

  const tick = () => {
    if (live) {
      const next = chainHead();
      if (next > head) {
        const prev = head;
        head = next;
        refreshGas();
        view?.live?.(prev);
      }
    }
    document.querySelectorAll('[data-ts]').forEach((el) => { el.textContent = ago(Number(el.dataset.ts)); });
    document.querySelectorAll('[data-confirm]').forEach((el) => {
      el.textContent = plural(head - Number(el.dataset.confirm) + 1, 'Block Confirmation');
    });
  };

  liveButton.addEventListener('click', () => {
    live = !live;
    liveButton.setAttribute('aria-pressed', String(live));
    liveButton.title = live ? 'Pause live updates' : 'Resume live updates';
    document.getElementById('live-label').textContent = live ? 'Live' : 'Paused';
    tick();
  });

  /* ---------- Small things ---------- */

  const writeClipboard = async (text) => {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  };

  document.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      try {
        await writeClipboard(copy.dataset.copy);
        copy.innerHTML = icon('done');
        copy.classList.add('is-done');
        copy.setAttribute('aria-label', 'Copied');
        setTimeout(() => {
          copy.innerHTML = icon('copy');
          copy.classList.remove('is-done');
          copy.setAttribute('aria-label', 'Copy to clipboard');
        }, 1500);
      } catch {
        copy.title = 'Copy failed';
      }
    }

    const target = event.target.closest('[data-scroll]');
    if (target) document.getElementById(target.dataset.scroll).scrollIntoView({ behavior: 'smooth' });

    const net = document.querySelector('.net[open]');
    if (net && !net.contains(event.target)) net.removeAttribute('open');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.querySelector('.net[open]')?.removeAttribute('open');
  });

  document.getElementById('to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.getElementById('year').textContent = new Date().getFullYear();

  refreshGas();
  route();
  setInterval(tick, 500);
})();
