import type { App } from '../app';
import { parseJoinCode, type Collab } from '../collab/collab';

/** Create an element with properties (className, value, disabled…) and children. */
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]) => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
};

const JOIN_WARNING =
  "Join this shared map?\n\nYour current map will be replaced by the host's. Save it first (Ctrl+S) if you want to keep it.";

/**
 * The "Together" panel: host a shared session and copy its link, or join one
 * by link or code; shows who's in the session.
 */
export function buildTogether(app: App, collab: Collab): void {
  const root = document.getElementById('together')!;

  const render = () => {
    root.replaceChildren();
    const { role } = collab;

    if (role === 'idle' || role === 'connecting') {
      const busy = role === 'connecting';
      const name = el('input', { type: 'text', className: 'text-input', value: collab.name, maxLength: 24, disabled: busy });
      name.setAttribute('aria-label', 'Your name');
      name.addEventListener('change', () => collab.setName(name.value));

      const hostBtn = el('button', { type: 'button', className: 'text-btn primary', disabled: busy }, 'Host a session');
      hostBtn.addEventListener('click', () => {
        collab.setName(name.value);
        collab.host();
      });

      const code = el('input', { type: 'text', className: 'text-input', placeholder: 'Link or code', disabled: busy });
      code.setAttribute('aria-label', 'Session link or code');
      const joinBtn = el('button', { type: 'button', className: 'text-btn', disabled: busy }, 'Join');
      const join = () => {
        const c = parseJoinCode(code.value);
        if (!c) {
          collab.error = 'Paste the link (or code) the host shared.';
          render();
          return;
        }
        if (!confirm(JOIN_WARNING)) return;
        collab.setName(name.value);
        collab.join(c);
      };
      joinBtn.addEventListener('click', join);
      code.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') join();
      });

      root.append(
        el('label', { className: 'field' }, el('span', {}, 'Your name'), name),
        el('div', { className: 'row' }, hostBtn),
        el('div', { className: 'row' }, code, joinBtn),
      );
      if (busy) root.append(el('p', { className: 'hint' }, 'Connecting…'));
      else root.append(el('p', { className: 'hint' }, 'Draw the map together in real time. One person hosts and sends the link.'));
    } else {
      if (role === 'host') {
        const link = el('input', { type: 'text', className: 'text-input', value: collab.link ?? '', readOnly: true });
        link.setAttribute('aria-label', 'Link to share');
        link.addEventListener('focus', () => link.select());
        const copy = el('button', { type: 'button', className: 'text-btn' }, 'Copy');
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(link.value);
            copy.textContent = 'Copied';
          } catch {
            link.select();
          }
          setTimeout(() => (copy.textContent = 'Copy'), 1500);
        });
        root.append(
          el('p', { className: 'hint' }, 'Hosting. Send this link (or the code ', el('strong', {}, collab.code ?? ''), ') to your friends:'),
          el('div', { className: 'row' }, link, copy),
        );
      } else {
        const host = collab.people.find((p) => p.host);
        root.append(el('p', { className: 'hint' }, app.paintBlocked ? 'Loading the shared map…' : `In ${host?.name ?? 'the host'}'s map.`));
      }

      const list = el('ul', { className: 'people' });
      for (const p of collab.people) {
        const me = p.name === collab.name && (p.host ? role === 'host' : role === 'guest');
        list.append(
          el(
            'li',
            {},
            el('span', { className: 'dot' }),
            `${p.name}${p.host ? ' (host)' : ''}${me ? ' — you' : ''}`,
          ),
        );
        (list.lastElementChild!.firstElementChild as HTMLElement).style.background = p.color;
      }
      const leave = el('button', { type: 'button', className: 'text-btn' }, role === 'host' ? 'End session' : 'Leave');
      leave.addEventListener('click', () => {
        if (role === 'host' && collab.people.length > 1 && !confirm('End the session for everyone? Everyone keeps their copy of the map.')) return;
        collab.leave();
      });
      root.append(list, el('div', { className: 'row' }, leave));
    }
    if (collab.error) root.append(el('p', { className: 'hint error' }, collab.error));
  };

  collab.onChange(render);
  render();

  // Opened from a join link: offer to join straight away.
  const code = new URLSearchParams(location.search).get('join');
  if (code) {
    history.replaceState(null, '', location.pathname + location.hash);
    const c = parseJoinCode(code);
    if (c && confirm(JOIN_WARNING)) collab.join(c);
  }
}
