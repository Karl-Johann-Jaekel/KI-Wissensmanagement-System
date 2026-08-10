import { Link } from 'react-router-dom'
import { Slash } from 'lucide-react'
import Popover from '../ui/Popover'
import { useSkills } from '../../lib/storage'

interface SkillPickerProps {
  onInsert: (content: string) => void
}

/** „/"-Button in der Chat-Leiste: gespeicherte Prompt-Vorlagen einfügen. */
export default function SkillPicker({ onInsert }: SkillPickerProps) {
  const skills = useSkills()

  return (
    <Popover
      label="Skill einfügen (Prompt-Vorlage)"
      trigger={<Slash className="h-4 w-4" />}
      className="rounded-lg border border-edge px-1.5"
    >
      {(close) => (
        <>
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Skills
          </p>
          {skills.length === 0 ? (
            <p className="px-2.5 pb-2 text-xs text-muted">
              Noch keine Skills.{' '}
              <Link
                to="/skills"
                onClick={close}
                className="text-primary-600 hover:underline dark:text-primary-400"
              >
                Anlegen →
              </Link>
            </p>
          ) : (
            skills.slice(0, 8).map((skill) => (
              <button
                key={skill.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onInsert(skill.content)
                  close()
                }}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-sunken"
              >
                <span className="text-sm font-medium text-ink">{skill.name}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">{skill.content}</span>
              </button>
            ))
          )}
        </>
      )}
    </Popover>
  )
}
