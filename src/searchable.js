import {
  createPrompt,
  useState,
  useKeypress,
  usePrefix,
  usePagination,
  isEnterKey,
  isUpKey,
  isDownKey,
  isSpaceKey,
  makeTheme,
} from '@inquirer/core';

/** Token fuzzy match: every whitespace-separated token must appear in the haystack. */
function tokenMatch(haystack, term) {
  const t = (term || '').trim().toLowerCase();
  if (!t) return true;
  const h = haystack.toLowerCase();
  return t.split(/\s+/).every((tok) => h.includes(tok));
}

/**
 * A searchable list prompt with live typeahead.
 *   - type any character  → filters the list as you go
 *   - backspace           → edit the search
 *   - up / down           → move the highlight
 *   - space               → check / uncheck (multiple mode only)
 *   - enter               → confirm (returns array in multiple mode, single value otherwise)
 *
 * config: { message, choices:[{name,value,checked?}], multiple?, pageSize?, helpText? }
 */
export const searchableList = createPrompt((config, done) => {
  const { message, choices, multiple = false, pageSize = 12, helpText } = config;
  const theme = makeTheme({}, config.theme);
  const prefix = usePrefix({ theme });

  const [status, setStatus] = useState('idle');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const [answerLabel, setAnswerLabel] = useState('');
  const [checked, setChecked] = useState(
    () => new Set(choices.filter((c) => c.checked).map((c) => c.value)),
  );

  const filtered = choices.filter((c) => tokenMatch(c.name, search));
  const activeIndex = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1);

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      if (multiple) {
        setStatus('done');
        setAnswerLabel(`${checked.size} selected`);
        done([...checked]);
      } else if (activeIndex >= 0) {
        const sel = filtered[activeIndex];
        setStatus('done');
        setAnswerLabel(sel.name);
        done(sel.value);
      }
      return;
    }

    if (isUpKey(key)) {
      if (filtered.length) setActive((activeIndex - 1 + filtered.length) % filtered.length);
      return;
    }
    if (isDownKey(key)) {
      if (filtered.length) setActive((activeIndex + 1) % filtered.length);
      return;
    }

    if (isSpaceKey(key) && multiple) {
      // In checkbox mode, space toggles the highlighted item. readline appends
      // the space to its buffer — strip it so it never pollutes the search term.
      if (rl.line.endsWith(' ')) {
        rl.line = rl.line.slice(0, -1);
        rl.cursor = rl.line.length;
      }
      if (activeIndex >= 0) {
        const val = filtered[activeIndex].value;
        const next = new Set(checked);
        if (next.has(val)) next.delete(val);
        else next.add(val);
        setChecked(next);
      }
      return;
    }

    // Any other key (printable chars, backspace) is already reflected in
    // readline's line buffer — mirror it into our search term.
    if (rl.line !== search) {
      setSearch(rl.line);
      setActive(0);
    }
  });

  const page = usePagination({
    items: filtered,
    active: activeIndex < 0 ? 0 : activeIndex,
    renderItem({ item, isActive }) {
      const pointer = isActive ? '❯' : ' ';
      const box = multiple ? (checked.has(item.value) ? '[x]' : '[ ]') : ' ';
      const text = multiple ? `${pointer} ${box} ${item.name}` : `${pointer} ${item.name}`;
      return isActive ? theme.style.highlight(text) : `  ${text.slice(2)}`;
    },
    pageSize,
    loop: false,
  });

  if (status === 'done') {
    return `${prefix} ${theme.style.message(message, status)} ${theme.style.answer(answerLabel)}`;
  }

  const searchLine = `  ${theme.style.help('search:')} ${
    search ? theme.style.highlight(search) : theme.style.help('(type to filter)')
  }`;
  const counter = theme.style.help(
    multiple
      ? `  ${filtered.length} shown · ${checked.size} selected`
      : `  ${filtered.length} shown`,
  );
  const body = filtered.length ? page : theme.style.help('  (no matches)');
  const help = theme.style.help(
    helpText ||
      (multiple
        ? '  ↑↓ move · space check/uncheck · type to search · enter to confirm'
        : '  ↑↓ move · type to search · enter to select'),
  );

  return `${prefix} ${theme.style.message(message, status)}\n${searchLine}\n${counter}\n${body}\n${help}`;
});
