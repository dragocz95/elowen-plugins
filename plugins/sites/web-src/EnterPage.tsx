import { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { runtime, jsonBody, type TicketResponse } from './runtime.js';

type Phase = 'working' | 'denied';

/** The app half of a site's sign-in.
 *
 *  A published site is served by the daemon on a path that carries no Elowen identity, so a visitor who
 *  needs to prove who they are is bounced here, inside the authenticated app. This page asks for a
 *  one-time ticket and hands it to the site with a form POST rather than a redirect: a token in a URL
 *  ends up in history, logs and the Referer header, and the app's own API must not answer with a
 *  redirect either — the server-side proxy in front of it follows redirects and drops their cookies. */
export function EnterPage() {
  const { components, hooks } = runtime();
  const { WorkspacePage, PluginPageHeader, LoadingState, EmptyState } = components;
  const strings = hooks.usePluginStrings('sites');
  const [phase, setPhase] = useState<Phase>('working');
  const formRef = useRef<HTMLFormElement | null>(null);
  const [handoff, setHandoff] = useState<{ action: string; token: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('site') ?? '';
    const returnPath = params.get('r') ?? '';
    if (!slug) { setPhase('denied'); return; }

    void runtime()
      .api('/plugins/sites/api/ticket', jsonBody('POST', { slug, r: returnPath }))
      .then((data) => {
        const ticket = data as TicketResponse;
        if (!ticket?.token || !ticket?.action) { setPhase('denied'); return; }
        setHandoff({ action: ticket.action, token: ticket.token });
      })
      .catch(() => setPhase('denied'));
  }, []);

  useEffect(() => {
    if (handoff) formRef.current?.submit();
  }, [handoff]);

  return (
    <WorkspacePage>
      <PluginPageHeader title={strings.title ?? 'Sites'} icon={Globe} />
      {phase === 'working' ? <LoadingState /> : (
        <EmptyState
          title={strings.emptyShared ?? 'You do not have access to this site.'}
          description={strings.subtitle}
          icon={Globe}
        />
      )}
      {handoff ? (
        <form ref={formRef} method="POST" action={handoff.action} className="hidden">
          <input type="hidden" name="t" value={handoff.token} />
        </form>
      ) : null}
    </WorkspacePage>
  );
}
