import { useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { runtime } from './runtime';

const { Button, Input, Modal, ModalBody, ModalFooter } = runtime().components;
const { usePluginStrings, useResetUsage, useToast, useTranslation } = runtime().hooks;

export function ResetUsageModal({ onClose }: { onClose: () => void }) {
  const s = usePluginStrings('stats');
  const { t } = useTranslation();
  const { toast } = useToast();
  const reset = useResetUsage();
  const confirmInputId = useId();
  const [typed, setTyped] = useState('');
  const armed = typed.trim().toLocaleUpperCase() === s.resetConfirmWord.toLocaleUpperCase();

  const onConfirm = () => {
    reset.mutate(undefined, {
      onSuccess: () => { toast(s.resetDone); onClose(); },
      onError: () => toast(s.resetFailed, 'error'),
    });
  };

  return (
    <Modal title={s.resetTitle} onClose={onClose} size="sm" icon={AlertTriangle}>
      <ModalBody>
        <p className="text-sm leading-relaxed text-text-muted">{s.resetBody}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={confirmInputId} className="text-xs text-text-muted">{s.resetConfirmHint.replace('{word}', s.resetConfirmWord)}</label>
          <Input id={confirmInputId} value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus spellCheck={false} className="font-mono" />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="ghost-danger" onClick={onConfirm} disabled={!armed || reset.isPending}>{s.resetConfirm}</Button>
      </ModalFooter>
    </Modal>
  );
}
