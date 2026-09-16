import { useMemo, useRef, useState } from 'react';
import { BookOpen, Play, Trash2 } from 'lucide-react';
import { runtime, type PluginChatPickerProps, type PluginSkill } from './runtime';

/** The skills plugin's chat picker. It owns both the skill list and its deletion action; the host only
 * supplies the authenticated message sender and modal lifecycle. */
export function SkillsPicker({ send, close }: PluginChatPickerProps) {
  const { components: C, hooks, utils } = runtime();
  const strings = hooks.usePluginStrings('skills');
  const skills = hooks.usePluginSkills();
  const remove = hooks.useDeletePluginSkill();
  const { toast } = hooks.useToast();
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<PluginSkill | null>(null);
  const deleting = useRef(false);
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = skills.data ?? [];
    return needle ? all.filter((skill) => skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)) : all;
  }, [filter, skills.data]);

  const deleteSkill = async (): Promise<void> => {
    if (!pending || deleting.current) return;
    deleting.current = true;
    try {
      await remove.mutateAsync({ name: pending.name, owner: pending.owner });
      setPending(null);
    } catch (error) {
      toast(utils.apiErrorMessage(error), 'error');
    } finally {
      deleting.current = false;
    }
  };

  return (
    <>
      <C.Modal title={strings.pickerTitle} onClose={close} size="md" icon={BookOpen} intent="inspect">
        <C.ModalBody gap={4}>
          <C.Input value={filter} onChange={(event: { target: { value: string } }) => setFilter(event.target.value)} placeholder={strings.pickerFilter} aria-label={strings.pickerFilter} />
          {skills.isLoading ? <C.LoadingState variant="list" /> : skills.isError ? (
            <C.ErrorState message={strings.unavailable} onRetry={() => skills.refetch()} />
          ) : rows.length === 0 ? <C.EmptyState title={strings.pickerEmpty} description={strings.pickerEmptyDesc} icon={BookOpen} /> : (
            <div className="flex flex-col gap-px overflow-hidden rounded-md border border-border bg-border/50">
              {rows.map((skill) => (
                <div key={skill.name + ':' + String(skill.owner ?? 'shared')} className="flex items-center gap-2 bg-card px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-xs text-foreground">/skill:{skill.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{[skill.scope ?? skill.source, skill.description].filter(Boolean).join(' · ')}</span>
                  </div>
                  <C.IconButton icon={Play} label={strings.pickerLoad} disabled={skill.active === false} onClick={() => { send('/skill:' + skill.name); close(); }} />
                  <C.IconButton icon={Trash2} label={strings.pickerDelete} variant="danger" disabled={!skill.canDelete} onClick={() => setPending(skill)} />
                </div>
              ))}
            </div>
          )}
        </C.ModalBody>
      </C.Modal>
      <C.ConfirmDialog
        open={pending !== null}
        title={strings.pickerDeleteTitle}
        description={pending ? strings.pickerDeleteDesc.replace('{name}', '/skill:' + pending.name) : undefined}
        onConfirm={deleteSkill}
        pending={remove.isPending || deleting.current}
        onClose={() => { if (!deleting.current) setPending(null); }}
      />
    </>
  );
}
