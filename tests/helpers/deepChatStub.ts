/** The shared deep-chat stand-in for the widget suites. deep-chat renders the messages; it is a browser
 *  artifact and not what is under test here, so both suites drive this stub instead of the real bundle.
 *
 *  One class, because the two suites had grown the same stub twice: the widget suite's version is the
 *  richer one (message DOM, submit transport, scroll and visibility hooks) and the appearance suite only
 *  needs it to exist and to take configuration. Each suite still owns its own `vi.mock('deep-chat', …)`
 *  call — the mock factory cannot reference this module statically because Vitest hoists `vi.mock`
 *  above the imports, so factories reach it through a dynamic import and keep the guarded
 *  custom-element registration beside it. */
export class DeepChatStub extends HTMLElement {
  history: unknown[] = [];
  /** The real element calls this once its first render is done, which is what makes it able to take
   *  messages. The stub renders the moment it reaches the document, so that is when it calls back. */
  onComponentRender?: (ref: unknown) => void;
  connectedCallback(): void {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      const list = document.createElement('div');
      list.id = 'messages';
      root.append(list);
    }
    this.onComponentRender?.(this);
  }
  getMessages(): { role?: string; text?: string; html?: string }[] { return this._messages; }
  addMessage(message: { role?: string; text?: string; html?: string }): void {
    this._messages.push(message);
    const outer = document.createElement('div');
    outer.className = `outer-message-container deep-chat-outer-container-role-${message.role ?? 'ai'}`;
    const inner = document.createElement('div');
    inner.className = 'inner-message-container';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble text-message';
    bubble.textContent = message.text ?? '';
    inner.append(bubble);
    outer.append(inner);
    this.shadowRoot?.querySelector('#messages')?.append(outer);
  }
  updateMessage(message: { text?: string }, index: number): void {
    this._messages[index] = { role: 'ai', ...message };
    const bubble = this.shadowRoot?.querySelectorAll('.message-bubble')[index];
    if (bubble) bubble.textContent = message.text ?? '';
  }
  /** Like the real element: the submit path draws the message and hands it to the configured transport,
   *  whose signals are what put up the typing indicator. */
  submitUserMessage(content: { text?: string }): void {
    this.addMessage({ role: 'user', text: content.text });
    this.submitted.push(content.text ?? '');
    const connect = (this as unknown as { connect?: { handler?(body: unknown, signals: unknown): void } }).connect;
    connect?.handler?.({ messages: [{ role: 'user', text: content.text }] }, {
      onOpen: () => undefined, onResponse: () => undefined, onClose: () => undefined, stopClicked: {},
    });
  }
  submitted: string[] = [];
  focusInput(): void { /* no focus in jsdom */ }
  disableSubmitButton(): void { /* no input validation in the renderer stub */ }
  /** Unit tests cover the visibility gate; the browser regression measures actual scroll geometry. */
  get clientHeight(): number { return this.closest('section')?.hidden ? 0 : 400; }
  scrollToBottom(): void { this.scrolledToBottom += 1; }
  scrolledToBottom = 0;
  private readonly _messages: { role?: string; text?: string; html?: string }[] = [];
}
